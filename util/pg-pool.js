import {config} from "dotenv";
import * as pg from "pg";
import {readSecretFile} from "./secret-file.js";

const {Pool} = pg.default;

config();

const pool = new Pool({
    host: process.env.DATABASE_HOST || "localhost",
    user: process.env.DATABASE_USER || "labeling_admin",
    database: process.env.DATABASE_NAME || "labeling",
    password: process.env.DATABASE_PASS_FILE
        ? readSecretFile(process.env.DATABASE_PASS_FILE, "DATABASE_PASS_FILE")
        : undefined,
    port: process.env.DATABASE_PORT || 5432,
});

export default pool;
