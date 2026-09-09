import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {readSecretFile} from "../util/secret-file.js";

test("secret reader returns a file secret with one terminal line ending removed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-secret-file-"));
    const secretFile = path.join(directory, "database-password");
    await writeFile(secretFile, "database-secret\r\n", {mode: 0o400});

    try {
        assert.equal(readSecretFile(secretFile, "DATABASE_PASS_FILE"), "database-secret");
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("secret reader rejects unsafe inputs with a field-only error", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-secret-file-"));
    const secretFile = path.join(directory, "sentinel-secret-path");
    const sentinel = "sentinel-secret-content";
    await writeFile(secretFile, `${sentinel}\n`, {mode: 0o644});

    try {
        const emptyFile = path.join(directory, "empty-secret");
        await writeFile(emptyFile, "\n", {mode: 0o400});
        for (const file of ["relative-secret", secretFile, emptyFile]) {
            assert.throws(() => readSecretFile(file, "DATABASE_PASS_FILE"), error => {
                assert.equal(error.code, "SECRET_FILE_INVALID");
                assert.equal(error.message, "SECRET_FILE_INVALID DATABASE_PASS_FILE");
                assert.equal(error.message.includes(secretFile), false);
                assert.equal(error.message.includes(sentinel), false);
                return true;
            });
        }
    } finally {
        await rm(directory, {recursive: true});
    }
});
