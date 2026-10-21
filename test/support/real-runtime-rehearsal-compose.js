import path from "node:path";

const rehearsalCompose = fixture => {
    const {directory, project, images, root, profiles, nodeInputs, databaseReader} = fixture;
    const bind = (source, target) => ({type: "bind", source, target, read_only: true});
    const secret = name => path.join(nodeInputs, name);
    const code = ["util", "scripts", "schema", "routes", "views", "public"].map(name => bind(path.join(root, name), `/labeling/${name}`));
    const files = ["index.js", "app.js"].map(name => bind(path.join(root, name), `/labeling/${name}`));
    const connection = {DATABASE_HOST: "labeling-database", DATABASE_PORT: "5432", DATABASE_NAME: "rehearsal",
        DATABASE_USER: "rehearsal", DATABASE_PASS_FILE: "/run/secrets/database-password"};
    const health = command => ({test: ["CMD-SHELL", command], interval: "1s", timeout: "2s", retries: 5, start_period: "1s"});
    const hardened = {read_only: true, cap_drop: ["ALL"], tmpfs: ["/tmp:rw,nosuid,nodev,size=64m,mode=1777"], restart: "no"};
    const services = {
        "labeling-database": {...hardened, container_name: `${project}-db`, image: images.database,
            environment: {POSTGRES_DB: "rehearsal", POSTGRES_USER: "rehearsal", POSTGRES_PASSWORD_FILE: "/run/secrets/database-password"},
            command: ["postgres", "-c", "log_line_prefix=REHEARSAL_SQL "],
            cap_add: ["CHOWN", "FOWNER", "DAC_OVERRIDE", "SETUID", "SETGID"],
            tmpfs: [...hardened.tmpfs, `/var/run/postgresql:rw,uid=${databaseReader.uid},gid=${databaseReader.gid},mode=0775`],
            volumes: [{type: "volume", source: "data", target: "/var/lib/postgresql/data"}, bind(secret("pg-password"), "/run/secrets/database-password")],
            ports: ["127.0.0.1::5432"], networks: {default: {aliases: ["labeling-database"]}},
            healthcheck: health("pg_isready -h 127.0.0.1 -U rehearsal -d rehearsal")},
        "labeling-study-prepare": {...hardened, image: images.server, group_add: ["1000"],
            command: ["sh", "scripts/prepare-study-deployment.sh"],
            environment: {...connection, STUDY_DATABASE_MODE: "clean", STUDY_PROFILES_INPUT: "/run/config/study-profiles.json",
                STUDY_CONFIG_INPUT: "", STUDY_CSV_PATH: "/labeling/data/copilot-369-cards.csv", GITHUB_ENRICHMENT_ENABLED: "false"},
            volumes: [...code, bind(secret("database-password"), connection.DATABASE_PASS_FILE),
                bind(secret("descriptor.json"), "/run/config/study-profiles.json"),
                ...profiles.flatMap((_profile, index) => [bind(secret(`profiles/${index}-config.json`), `/run/config/studies/${index === 0 ? "current" : "validation-30"}.json`),
                    bind(secret(`profiles/${index}-accountManifest.json`), `/run/secrets/studies/${index === 0 ? "current" : "validation-30"}.json`)])]},
        "labeling-server": {...hardened, image: images.server, container_name: `${project}-app`,
            environment: {...connection, NODE_ENV: "production", APP_ORIGIN: "https://localhost", TRUST_PROXY_HOPS: "1",
                SESSION_SECRET_FILE: "${REHEARSAL_SESSION_PATH:-/run/secrets/session-current}", SESSION_SECRET_PREVIOUS_FILE: "/run/secrets/session-previous"},
            volumes: [...code, ...files, bind(secret("database-password"), connection.DATABASE_PASS_FILE),
                bind(secret("session-current"), "/run/secrets/session-current"), bind(secret("session-previous"), "/run/secrets/session-previous")],
            tmpfs: [...hardened.tmpfs, "/labeling/logs:rw,uid=1000,gid=1000,mode=0755"],
            healthcheck: health("wget -q -O /dev/null http://127.0.0.1:3000/actuator/health"),
            networks: {default: {aliases: ["labeling-server"]}}},
        "labeling-caddy": {...hardened, image: images.caddy, container_name: `${project}-edge`,
            cap_add: ["NET_BIND_SERVICE"],
            environment: {PUBLIC_HOSTNAME: "localhost"}, ports: ["127.0.0.1::443"],
            volumes: [bind(path.join(directory, "Caddyfile"), "/etc/caddy/Caddyfile"),
                {type: "volume", source: "caddy-data", target: "/data"}, {type: "volume", source: "caddy-config", target: "/config"}],
            healthcheck: health("wget -q -O /dev/null http://127.0.0.1:2019/config/")},
    };
    return {name: project, services, volumes: {data: {name: `${project}-data`}, "caddy-data": {name: `${project}-caddy-data`},
        "caddy-config": {name: `${project}-caddy-config`}}, networks: {default: {name: `${project}-network`}}};
};

export {rehearsalCompose};
