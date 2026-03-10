package migrations

import (
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"regexp"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	pg "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq"
)

// SQLFiles must be set by the caller (main package) before RunMigrations is
// called. It holds the embedded root-level migrations directory.
// This indirection is needed because go:embed cannot reference files outside
// the package directory, so the embed directive lives in the root migrations package.
var SQLFiles fs.FS

// RunMigrations runs embedded SQL migrations using the postgres driver.
// SQLFiles must be set before calling this function.
// The SQL files are compiled into the binary via go:embed — no
// migrations directory needs to be present on the server at runtime.
// It will attempt to baseline the DB to the latest migration if the DB already
// has the schema (players table exists) but migrate's metadata table is missing.
func RunMigrations(databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("database URL is empty")
	}
	if SQLFiles == nil {
		return fmt.Errorf("migrations.SQLFiles is not set — embed the migrations directory in main")
	}

	sqlDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("failed to open DB: %w", err)
	}
	defer sqlDB.Close()

	driver, err := pg.WithInstance(sqlDB, &pg.Config{MigrationsTable: "schema_migrations_migrate"})
	if err != nil {
		return fmt.Errorf("failed to create migrate driver: %w", err)
	}

	// Use iofs source so migrations are read from the embedded FS, not disk.
	src, err := iofs.New(SQLFiles, ".")
	if err != nil {
		return fmt.Errorf("failed to create iofs source: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}

	// If DB already has schema but migrate metadata table does not exist, baseline to latest migration.
	var playersExist bool
	row := sqlDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='players')")
	if err := row.Scan(&playersExist); err == nil && playersExist {
		var migrateTableExist bool
		row2 := sqlDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='schema_migrations_migrate')")
		if err := row2.Scan(&migrateTableExist); err == nil && !migrateTableExist {
			latest := findLatestMigrationVersion(SQLFiles)
			if latest > 0 {
				log.Printf("[MIGRATE] Baseline DB to version %d (existing schema present)", latest)
				if ferr := m.Force(int(latest)); ferr != nil {
					log.Printf("[MIGRATE] Force to version %d failed: %v", latest, ferr)
				}
			}
		}
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migration up failed: %w", err)
	}

	log.Printf("[MIGRATE] Migrations applied (no changes or up completed)")
	return nil
}

// findLatestMigrationVersion scans the embedded SQL files for files that start
// with a numeric version prefix (e.g. 000001_) and returns the highest version number.
func findLatestMigrationVersion(fsys fs.FS) int64 {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return 0
	}

	re := regexp.MustCompile(`^0*([0-9]+)_`)
	var max int64
	for _, f := range entries {
		if f.IsDir() {
			continue
		}
		m := re.FindStringSubmatch(f.Name())
		if len(m) < 2 {
			continue
		}
		v, _ := strconv.ParseInt(m[1], 10, 64)
		if v > max {
			max = v
		}
	}

	return max
}
