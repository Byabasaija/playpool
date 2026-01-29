package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/playmatatu/backend/internal/admin"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/database"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize configuration
	cfg := config.Load()

	// Initialize database
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Seed admin account
	phone := os.Getenv("ADMIN_PHONE")
	if phone == "" {
		phone = "256700000000" // Default phone
		log.Printf("Using default admin phone: %s", phone)
	}

	adminToken := os.Getenv("ADMIN_TOKEN")
	if adminToken == "" {
		adminToken = "change-me-in-production" // Default token
		log.Printf("WARNING: Using default admin token. Set ADMIN_TOKEN env var in production!")
	}

	displayName := "Admin"
	roles := []string{"super_admin"}
	allowedIPs := []string{} // Empty = allow from any IP

	err = admin.CreateAdminAccount(db, phone, displayName, adminToken, roles, allowedIPs)
	if err != nil {
		log.Fatalf("Failed to create admin account: %v", err)
	}

	log.Printf("✓ Admin account created/updated successfully")
	log.Printf("  Phone: %s", phone)
	log.Printf("  Display Name: %s", displayName)
	log.Printf("  Roles: %v", roles)
	log.Println("\nYou can now login at /pm-admin with:")
	log.Printf("  Phone: %s", phone)
	log.Printf("  Token: %s", adminToken)
}
