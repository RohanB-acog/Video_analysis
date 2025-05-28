#!/usr/bin/env -S npx tsx
import fs from "fs/promises";
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: count-json-objects.ts <file>");
    process.exit(1);
  }
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      console.log(data.length);
    } else {
      console.log("0");
    }
  } catch (error) {
    console.error("Error parsing JSON:", error.message);
    console.log("0");
  }
}
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
