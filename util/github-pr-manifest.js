import {createHash} from "node:crypto";

const canonicalize = value => {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
};

const checksum = value => createHash("sha256").update(canonicalize(value)).digest("hex");
const checksumRaw = value => createHash("sha256").update(value).digest("hex");

const pageManifestEntry = page => ({
    endpoint: page.endpoint,
    pageOrdinal: page.pageOrdinal,
    apiVersion: page.apiVersion,
    accept: page.accept,
    requestFingerprint: page.requestFingerprint,
    etag: page.etag ?? null,
    httpStatus: page.httpStatus ?? null,
    responseChecksum: page.responseChecksum ?? null,
    normalizedChecksum: page.normalizedChecksum ?? null,
    itemCount: page.itemCount ?? null,
    nextUrl: page.nextUrl ?? null,
    state: page.state,
});

const buildSnapshotManifest = ({pages, normalizerVersion = "1"}) => ({
    normalizerVersion,
    pages: [...pages].sort((left, right) => left.endpoint.localeCompare(right.endpoint) || left.pageOrdinal - right.pageOrdinal).map(pageManifestEntry),
});

const checksumSnapshotManifest = input => checksum(buildSnapshotManifest(input));

const buildRunManifest = ({snapshots}) => [...snapshots]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(snapshot => ({ordinal: snapshot.ordinal, snapshotChecksum: snapshot.snapshotChecksum}));

const checksumRunManifest = input => checksum(buildRunManifest(input));

const isExactPageValidatorMatch = (requested, baseline) => Boolean(
    baseline
    && (baseline.runState === undefined || baseline.runState === "COMPLETED")
    && requested.repository === baseline.repository
    && requested.number === baseline.number
    && requested.endpoint === baseline.endpoint
    && requested.pageOrdinal === baseline.pageOrdinal
    && requested.requestFingerprint === baseline.requestFingerprint
    && requested.apiVersion === baseline.apiVersion
    && requested.accept === baseline.accept,
);

export {
    buildRunManifest,
    buildSnapshotManifest,
    canonicalize,
    checksum,
    checksumRaw,
    checksumRunManifest,
    checksumSnapshotManifest,
    isExactPageValidatorMatch,
};
