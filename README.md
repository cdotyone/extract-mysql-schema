# extract-mysql-schema
#### MySQL Schema Extractor

A command-line tool to extract MySQL database schemas and generate SQL files. This tool connects to a MySQL database, extracts table structures, stored procedures, and generates comprehensive SQL files that can be used for documentation, backup, or database replication.

## Installation

```bash
npm install extract-mysql-schema -g
```

## Requirements

- Node.js
- MySQL database access
- A configuration file with database connection details

## Configuration

Create a configuration file (e.g., `config.js`) with your MySQL connection details:

```javascript
module.exports = {
  connection: {
    host: 'localhost',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name', // required
    port: 3306,
    location: "../connections.json" // optional - connections can be in external file
  }
};
```

### External Connections File

    password: 'your_password',
    password: 'your_password',
Alternatively, you can use an external JSON file to store multiple database connections. When using the `location` property in your config, the tool will look up the database by "database" name in the external file:

**connections.json:**
```json
{
  "your_database_name": {
    "engine": "mysql",
    "host": "localhost",
    "user": "your_username",
    "password": "your_password",
    "database": "your_database_name",
    "charset": "utf8"
  },
  "production_db": {
    "engine": "mysql",
    "host": "prod-server.example.com",
    "user": "prod_user",
    "password": "prod_password",
    "database": "production_db",
    "charset": "utf8"
  }
}
```

When using an external connections file, the tool will use the `database` property from your config to find the matching connection in the external file.



## Command Line Usage

### Basic Syntax

```bash
extract-mysql-schema --configFile <path-to-config> [options]
```

### Required Options

- `--configFile <path>` - Path to your configuration file (required)

### Optional Options

- `--outputFile <path>` - Write JSON schema output to a file instead of console
- `--debug` - Enable debug mode for detailed logging
- `--procedureISV` - Include Information Schema Values for stored procedures
- `--writeSql` - Generate SQL files organized by type

## Examples

### Extract schema and output JSON to console

```bash
extract-mysql-schema --configFile config.js
```

### Extract schema and save JSON to file

```bash
extract-mysql-schema --configFile config.js --outputFile schema.json
```

### Generate SQL files

```bash
extract-mysql-schema --configFile config.js --writeSql
```

### Extract with all options enabled

```bash
extract-mysql-schema --configFile config.js --outputFile schema.json --writeSql --debug --procedureISV
```

### Using a relative path for config

```bash
extract-mysql-schema --configFile ./config/database.js --outputFile ./output/schema.json
```

## Output Files

When using the `--writeSql` option, the tool generates several SQL files:

### Individual Files

- **`tables/`** - Directory containing individual table definition files
  - Each table gets its own `.sql` file (e.g., `users.sql`, `orders.sql`)

- **`procedures/`** - Directory containing individual stored procedure files
  - Each procedure gets its own `.sql` file

- **`seed/`** - Directory for seed data files (if they exist)
  - Reads existing seed files and includes them in output

- **`patch/`** - Directory for database patches (if they exist)
  - Reads existing patch files and includes them in output

### Consolidated Files

- **`0.init.sql`** - Database initialization (CREATE DATABASE and USE statements)
- **`1.table.sql`** - All table definitions in proper dependency order
- **`2.seed.sql`** - All seed data
- **`3.procedures.sql`** - All stored procedures
- **`4.patch.sql`** - All database patches
- **`init.sql`** - Complete database script (combines all of the above)

## JSON Output Structure

The JSON output contains:

```json
{
  "database_name": {
    "name": "database_name",
    "tables": [
      {
        "name": "table_name",
        "schemaName": "database_name",
        "kind": "table",
        "columns": [...],
        "definition": "CREATE TABLE SQL..."
      }
    ],
    "tableOrder": ["table1", "table2", ...],
    "views": [...],
    "procedures": [...]
  }
}
```

### Column Properties

Each column includes:
- `name` - Column name
- `ordinalPosition` - Position in table
- `sqltype` - Full SQL type definition
- `type` - Base data type
- `maxLength` - Maximum length (for strings)
- `isPrimaryKey` - Boolean
- `isCompoundKey` - Boolean (part of compound key)
- `isNullable` - Boolean
- `isAutoNumber` - Boolean (auto_increment)
- `generated` - Generation type: "STORED", "ALWAYS", "BY DEFAULT", or "NEVER"
- `expression` - Generation expression (if applicable)
- `isUpdatable` - Boolean
- `defaultValue` - Default value
- `references` - Array of foreign key relationships

### Procedure Properties

Each procedure includes:
- `name` - Procedure name
- `schemaName` - Database name
- `kind` - "procedure"
- `definition` - Complete CREATE PROCEDURE statement
- `params` - Array of parameter definitions

## Table Dependency Ordering

The tool automatically determines the correct order for creating tables based on foreign key dependencies. Tables without dependencies are created first, followed by dependent tables in the correct order. This ensures SQL files can be executed without foreign key constraint errors.

## Error Handling

If the command is run without required arguments:
```
Expected at least one argument!
```

If an unknown option is provided:
```
Expected a known option
```

## Notes

- Tables are organized in dependency order to respect foreign key constraints
- Generated SQL files use `IF NOT EXISTS` and `IF EXISTS` for safe re-execution
- All paths are relative to the current working directory
- The tool handles compound keys, auto-increment fields, and generated columns

## License

See [LICENSE](LICENSE) file for details.
