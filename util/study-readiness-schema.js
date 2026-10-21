import {readCopilot369SchemaContract} from "./copilot-369-schema-contract.js";

const readReadinessSchemaContract = async client => {
    await client.query("SET LOCAL search_path TO public, pg_catalog, pg_temp");
    return readCopilot369SchemaContract(client, {normalizeDependencies: true});
};

export {readReadinessSchemaContract};
