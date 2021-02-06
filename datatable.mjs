import { Router, Route } from "router.mjs";

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

const listColumns = async (request, storage, env) => {
  const columns = (await storage.get("columns")) || [];
  return jsonResponse(columns);
};

const createColumn = async (request, storage, env) => {
  const column = await request.json();
  await storage.transaction(async (txn) => {
    const existingColumns = (await txn.get("columns")) || [];
    const id = (existingColumns[existingColumns.length - 1].id || 0) + 1;
    await txn.put("columns", [
      ...existingColumns,
      {
        ...column,
        id,
      },
    ]);
  });
  return await listColumns(request, storage, env);
};

const listRows = async (request, storage, env) => {
  const data = (await storage.list({ prefix: "data:" })) || new Map();
  const rows = new Map();

  data.forEach((value, key) => {
    const parts = key.split(":");
    const rowID = parts[1];
    const columnID = parts[2];
    const row = rows.get(rowID) || { id: rowID, values: [] };
    row.values.push({ id: columnID, value });
    rows.set(rowID, row);
  });

  return jsonResponse([...rows.values()]);
};

const updateValue = async (request, storage, env) => {
  const { columnID, rowID, value } = await request.json();
  await storage.put(`data:${rowID}:${columnID}`, value);

  return await listRows(request, storage, env);
};

const raw = async (request, storage, env) => {
  const data = (await storage.list({ prefix: "data:" })) || new Map();
  return jsonResponse(Object.fromEntries(data.entries()));
};

const wipe = async (request, storage, env) => {
  const data = (await storage.list({ prefix: "data:" })) || new Map();
  await Promise.all([...data.keys()].map((key) => storage.delete(key)));
  return await raw(request, storage, env);
};

const router = new Router();
router.routes = [
  [new Route("get", "/columns"), listColumns],
  [new Route("post", "/columns"), createColumn],
  [new Route("get", "/rows"), listRows],
  [new Route("post", "/value"), updateValue],
  [new Route("get", "/raw"), raw],
  [new Route("get", "/wipe"), wipe],
];

export class DataTable {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    try {
      return await router.handle(request, this.storage, this.env);
    } catch (e) {
      return jsonResponse({ message: e.message, stack: e.stack });
    }
  }
}
