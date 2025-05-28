// lib/db-connector.ts
import pg from "pg";
const { Pool } = pg;
import * as readline from "readline";

// Create readline interface for interactive CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export interface DatabaseConnectionConfig {
  host: string; // e.g., "10.100.0.2" (own3's IP) or "localhost" (if on own3)
  port: number; // e.g., 5432
  user: string; // e.g., "postgres"
  password: string; // e.g., "postgres"
  database: string; // e.g., "video_analysis_db"
}

export async function connectToDatabase(config: DatabaseConnectionConfig): Promise<Pool> {
  try {
    const pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: false, // SSL is disabled as per your previous preference
    });

    await pool.query("SELECT NOW()");
    console.log(`[INFO] Successfully connected to database ${config.database} at ${config.host}:${config.port}`);

    pool.on("error", (err) => {
      console.error("[ERROR] Unexpected error on idle client", err);
      throw err;
    });

    return pool;
  } catch (error) {
    console.error(`[ERROR] Failed to connect to database ${config.database} at ${config.host}:${config.port}:`, error);
    throw error;
  }
}

// Function to list all tables
async function listTables(pool: Pool) {
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    console.log("Tables in the database:");
    result.rows.forEach((row) => console.log(`- ${row.table_name}`));
  } catch (error) {
    console.error("Error listing tables:", error);
  }
}

// Function to describe a table (show schema)
async function describeTable(pool: Pool, tableName: string) {
  try {
    const result = await pool.query(
      `SELECT column_name, data_type, is_nullable 
       FROM information_schema.columns 
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    if (result.rows.length === 0) {
      console.log(`Table "${tableName}" not found.`);
      return;
    }
    console.log(`Schema of table "${tableName}":`);
    console.table(result.rows);
  } catch (error) {
    console.error(`Error describing table ${tableName}:`, error);
  }
}

// Function to run a custom query
async function runQuery(pool: Pool, query: string) {
  try {
    const result = await pool.query(query);
    if (result.rows.length > 0) {
      console.log("Query results:");
      console.table(result.rows);
    } else {
      console.log("No results returned.");
    }
  } catch (error) {
    console.error("Error executing query:", error);
  }
}

// Interactive CLI loop
async function startInteractiveCLI() {
  const config: DatabaseConnectionConfig = {
    host: "172.2.236.84", // Use "localhost" if running on own3, "10.100.0.2" if on another server
    port: 5432,
    user: "postgres",
    password: "postgres", // Or "new_strong_password" if changed
    database: "video_analysis_db",
  };

  const pool = await connectToDatabase(config);

  console.log("\nWelcome to the Database CLI!");
  console.log("Available commands:");
  console.log("- list: List all tables in the database");
  console.log("- describe <table_name>: Show the schema of a table");
  console.log("- query <SQL_query>: Run a custom SQL query (e.g., query SELECT * FROM videos)");
  console.log("- exit: Exit the CLI\n");

  const promptUser = () => {
    rl.question("Enter a command: ", async (input) => {
      const [command, ...args] = input.trim().split(/\s+/);

      switch (command.toLowerCase()) {
        case "list":
          await listTables(pool);
          break;
        case "describe":
          if (args.length === 0) {
            console.log("Please provide a table name (e.g., describe videos)");
          } else {
            await describeTable(pool, args[0]);
          }
          break;
        case "query":
          if (args.length === 0) {
            console.log("Please provide a SQL query (e.g., query SELECT * FROM videos)");
          } else {
            const query = args.join(" ");
            await runQuery(pool, query);
          }
          break;
        case "exit":
          console.log("Goodbye!");
          await pool.end();
          rl.close();
          return;
        default:
          console.log("Unknown command. Available commands: list, describe <table_name>, query <SQL_query>, exit");
      }

      promptUser(); // Prompt for the next command
    });
  };

  promptUser();
}

// Check if the script is being run directly
if (import.meta.url === new URL(import.meta.url).href) {
  startInteractiveCLI().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}