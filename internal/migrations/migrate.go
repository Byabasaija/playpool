package migrations

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	pg "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

// RunMigrations runs file-based migrations in ./migrations using the postgres driver.
// It will attempt to baseline the DB to the latest migration if the DB already
// has the schema (players table exists) but migrate's metadata table is missing.
func RunMigrations(databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("database URL is empty")
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

	m, err := migrate.NewWithDatabaseInstance("file://migrations", "postgres", driver)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}

	// If DB already has schema but migrate metadata table does not exist, baseline to latest migration
	var playersExist bool
	row := sqlDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='players')")
	if err := row.Scan(&playersExist); err == nil && playersExist {
		var migrateTableExist bool
		row2 := sqlDB.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='schema_migrations_migrate')")
		if err := row2.Scan(&migrateTableExist); err == nil && !migrateTableExist {
			latest := findLatestMigrationVersion("migrations")
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

// findLatestMigrationVersion scans the migrations directory for files that start with
// a numeric version prefix (e.g. 000001_) and returns the highest version number.
func findLatestMigrationVersion(dir string) int64 {
	files, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}

	re := regexp.MustCompile(`^0*([0-9]+)_`)
	var max int64
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		name := f.Name()
		m := re.FindStringSubmatch(name)
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
