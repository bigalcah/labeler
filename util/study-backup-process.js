import {spawn} from "node:child_process";

const transientTableData = Object.freeze([
    "public.app_session",
    "public.login_ip_attempt",
    "public.login_csrf_context",
    "public.github_api_telemetry_event",
]);

const waitForProcess = (child, label) => new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error(`${label} could not start`)));
    child.once("close", code => {
        if (code === 0) resolve();
        else reject(new Error(`${label} failed with exit code ${code}`));
    });
});

const terminateProcess = child => {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
};

const pipeCommands = async (producer, consumer, environment) => {
    const source = spawn(producer.command, producer.args, {
        env: environment,
        stdio: [ "ignore", "pipe", "ignore" ],
    });
    const destination = spawn(consumer.command, consumer.args, {
        env: environment,
        stdio: [ "pipe", "ignore", "ignore" ],
    });
    const processes = [
        waitForProcess(source, producer.command),
        waitForProcess(destination, consumer.command),
    ];
    const pipeFailure = new Promise((_resolve, reject) => {
        const rejectTransportError = error => {
            if (error.code !== "EPIPE") reject(error);
        };
        source.stdout.on("error", rejectTransportError);
        destination.stdin.on("error", rejectTransportError);
    });

    try {
        source.stdout.pipe(destination.stdin);
        await Promise.race([Promise.all(processes), pipeFailure]);
    } catch (error) {
        source.stdout.unpipe(destination.stdin);
        destination.stdin.destroy();
        terminateProcess(source);
        terminateProcess(destination);
        await Promise.allSettled(processes);
        throw error;
    }
};

const opensslDecrypt = (archivePath, encryptionKeyFile) => ({
    command: "openssl",
    args: [
        "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256",
        "-pass", `file:${encryptionKeyFile}`, "-in", archivePath,
    ],
});

const buildCreatePipeline = options => ({producer: {
    command: "pg_dump",
    args: [
        "--format=custom",
        "--no-password",
        `--snapshot=${options.snapshotId}`,
        `--host=${options.database.host}`,
        `--port=${options.database.port}`,
        `--username=${options.database.user}`,
        `--dbname=${options.database.database}`,
        ...transientTableData.map(table => `--exclude-table-data=${table}`),
    ],
}, consumer: {
    command: "openssl",
    args: [
        "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "600000", "-md", "sha256",
        "-pass", `file:${options.encryptionKeyFile}`, "-out", options.outputPath,
    ],
}});

const createEncryptedArchive = options => {
    const {producer, consumer} = buildCreatePipeline(options);
    return pipeCommands(producer, consumer, options.environment);
};

const inspectEncryptedArchive = options => pipeCommands(
    opensslDecrypt(options.archivePath, options.encryptionKeyFile),
    {command: "pg_restore", args: [ "--list" ]},
    options.environment,
);

const buildRestorePipeline = options => ({
    producer: opensslDecrypt(options.archivePath, options.encryptionKeyFile),
    consumer: {
        command: "pg_restore",
        args: [
            "--exit-on-error",
            "--no-owner",
            "--no-privileges",
            "--no-password",
            `--host=${options.targetDatabase.host}`,
            `--port=${options.targetDatabase.port}`,
            `--username=${options.targetDatabase.user}`,
            `--dbname=${options.targetDatabase.database}`,
            "-",
        ],
    },
});

const restoreEncryptedArchive = options => {
    const {producer, consumer} = buildRestorePipeline(options);
    return pipeCommands(producer, consumer, options.environment);
};

export {
    buildCreatePipeline,
    buildRestorePipeline,
    createEncryptedArchive,
    inspectEncryptedArchive,
    restoreEncryptedArchive,
    transientTableData,
};
