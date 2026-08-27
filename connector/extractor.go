package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	// Import drivers — only the sqlite driver is pure Go.
	// MySQL and MSSQL drivers are imported for side effects only.
	_ "github.com/glebarez/go-sqlite"
)

// UnifiedProduct is the standardized data format sent to PharmaStackX
type UnifiedProduct struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Barcode     string    `json:"barcode,omitempty"`
	Category    string    `json:"category,omitempty"`
	StockQty    int       `json:"stock_qty"`
	UnitPrice   float64   `json:"unit_price"`
	Supplier    string    `json:"supplier,omitempty"`
	ExpiryDate  string    `json:"expiry_date,omitempty"`
	LastUpdated time.Time `json:"last_updated"`
}

// ExtractionResult holds the full result of a data extraction
type ExtractionResult struct {
	PMS      string           `json:"pms"`
	Products []UnifiedProduct `json:"products"`
	Total    int              `json:"total"`
	ExtractedAt time.Time     `json:"extracted_at"`
}

// ExtractData connects to the local PMS database and extracts normalized product data.
func ExtractData(pmsName string, dbPath string) (*ExtractionResult, error) {
	log.Printf("[Extractor] Starting extraction for PMS: %s", pmsName)

	pmsLower := strings.ToLower(pmsName)

	switch {
	case strings.Contains(pmsLower, "galen"):
		return extractSQLite(pmsName, dbPath)
	case strings.Contains(pmsLower, "virtualrx"),
		strings.Contains(pmsLower, "healthtrac"),
		strings.Contains(pmsLower, "bewell"),
		strings.Contains(pmsLower, "pioneeerx"):
		return extractMySQL(pmsName)
	case strings.Contains(pmsLower, "medpro"),
		strings.Contains(pmsLower, "rxone"):
		return extractMSSQL(pmsName)
	default:
		// Try SQLite as a fallback if a dbPath was provided
		if dbPath != "" {
			return extractSQLite(pmsName, dbPath)
		}
		return nil, fmt.Errorf("unsupported PMS: %s", pmsName)
	}
}

// extractSQLite handles SQLite-based PMS systems (e.g. Galen)
func extractSQLite(pmsName, dbPath string) (*ExtractionResult, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("no database path provided for SQLite PMS")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("could not open SQLite database: %w", err)
	}
	defer db.Close()

	// Try common column name patterns used by pharmacy SQLite DBs
	queries := []string{
		`SELECT id, name, barcode, category, stock_qty, unit_price, supplier, expiry_date FROM products`,
		`SELECT ProductID, ProductName, Barcode, Category, StockQty, Price, Supplier, ExpiryDate FROM Products`,
		`SELECT drug_id, drug_name, barcode, category, quantity, price, supplier, expiry FROM drugs`,
	}

	for _, query := range queries {
		products, err := runQuery(db, pmsName, query)
		if err == nil {
			return &ExtractionResult{
				PMS:         pmsName,
				Products:    products,
				Total:       len(products),
				ExtractedAt: time.Now(),
			}, nil
		}
	}

	return nil, fmt.Errorf("could not find product table in SQLite database")
}

// extractMySQL handles MySQL-based PMS systems
func extractMySQL(pmsName string) (*ExtractionResult, error) {
	// Standard connection string — connector tries common defaults
	dsn := "root:@tcp(127.0.0.1:3306)/"

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("could not connect to MySQL: %w", err)
	}
	defer db.Close()

	// Find the pharmacy database
	rows, err := db.Query("SHOW DATABASES")
	if err != nil {
		return nil, fmt.Errorf("MySQL connection failed: %w", err)
	}
	defer rows.Close()

	var pharmDB string
	for rows.Next() {
		var dbName string
		rows.Scan(&dbName)
		lower := strings.ToLower(dbName)
		if strings.Contains(lower, "pharm") || strings.Contains(lower, "rx") || strings.Contains(lower, "drug") {
			pharmDB = dbName
			break
		}
	}

	if pharmDB == "" {
		return nil, fmt.Errorf("no pharmacy database found in MySQL")
	}

	query := fmt.Sprintf("SELECT id, name, barcode, category, stock_qty, unit_price, supplier, expiry_date FROM %s.products LIMIT 1000", pharmDB)
	products, err := runQuery(db, pmsName, query)
	if err != nil {
		return nil, err
	}

	return &ExtractionResult{
		PMS:         pmsName,
		Products:    products,
		Total:       len(products),
		ExtractedAt: time.Now(),
	}, nil
}

// extractMSSQL handles Microsoft SQL Server-based PMS systems
func extractMSSQL(pmsName string) (*ExtractionResult, error) {
	dsn := "server=127.0.0.1;port=1433;user id=sa;password=;database=PharmacyDB"

	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil, fmt.Errorf("could not connect to MSSQL: %w", err)
	}
	defer db.Close()

	query := `SELECT TOP 1000 id, name, barcode, category, stock_qty, unit_price, supplier, expiry_date FROM products`
	products, err := runQuery(db, pmsName, query)
	if err != nil {
		return nil, err
	}

	return &ExtractionResult{
		PMS:         pmsName,
		Products:    products,
		Total:       len(products),
		ExtractedAt: time.Now(),
	}, nil
}

// runQuery executes a SELECT and maps the results into UnifiedProduct structs
func runQuery(db *sql.DB, pmsName, query string) ([]UnifiedProduct, error) {
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var products []UnifiedProduct
	for rows.Next() {
		var p UnifiedProduct
		var id, name, barcode, category, supplier, expiry sql.NullString
		var stockQty sql.NullInt64
		var unitPrice sql.NullFloat64

		err := rows.Scan(&id, &name, &barcode, &category, &stockQty, &unitPrice, &supplier, &expiry)
		if err != nil {
			log.Printf("[Extractor] Row scan error: %v", err)
			continue
		}

		p.ID = id.String
		p.Name = name.String
		p.Barcode = barcode.String
		p.Category = category.String
		p.StockQty = int(stockQty.Int64)
		p.UnitPrice = unitPrice.Float64
		p.Supplier = supplier.String
		p.ExpiryDate = expiry.String
		p.LastUpdated = time.Now()

		products = append(products, p)
	}

	return products, nil
}
