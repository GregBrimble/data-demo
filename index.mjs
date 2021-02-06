import HTML from "index.html";
export { DataTable } from "datatable.mjs";
import { Router, Route } from "router.mjs";

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });

const wrap = (stub) => async (...args) => {
  const response = await stub.fetch(...args);
  return await response.json();
};

const getTableStub = (request, env) => {
  const url = new URL(request.url);
  const idString = url.pathname.split("/")[2];
  const id = env.tables.idFromString(idString);
  return wrap(env.tables.get(id));
};

const createTable = async (request, env) => {
  const { jurisdiction } = await request.json();
  const id = env.tables.newUniqueId({ jurisdiction });
  const idString = id.toString();
  await env.KV.put(`tables:${idString}`, idString);
  return jsonResponse({ id: idString });
};

const listTables = async (request, env) => {
  const { keys } = await env.KV.list({ prefix: "tables:" });
  const tableIds = keys.map((key) => key.name.split("tables:")[1]);
  return jsonResponse(tableIds);
};

const createColumn = async (request, env) => {
  const table = getTableStub(request, env);
  const url = new URL(request.url);
  url.pathname = "/columns";

  await table(
    new Request(url.toString(), { method: "POST", body: await request.text() })
  );

  return await getTable(request, env);
};

const updateValue = async (request, env) => {
  const table = getTableStub(request, env);
  const url = new URL(request.url);
  url.pathname = "/value";

  await table(
    new Request(url.toString(), { method: "POST", body: await request.text() })
  );

  return await getTable(request, env);
};

const getTable = async (request, env) => {
  const table = getTableStub(request, env);
  const url = new URL(request.url);
  url.pathname = "/columns";
  const columns = await table(url.toString());
  url.pathname = "/rows";
  const rows = await table(url.toString());

  return jsonResponse({
    columns,
    rows,
  });
};

const raw = async (request, env) => {
  const table = getTableStub(request, env);
  const url = new URL(request.url);
  url.pathname = "/raw";
  return jsonResponse(await table(url.toString()));
};

const wipe = async (request, env) => {
  const table = getTableStub(request, env);
  const url = new URL(request.url);
  url.pathname = "/wipe";
  return jsonResponse(await table(url.toString()));
};

const renderHTML = () =>
  new Response(HTML, { headers: { "Content-Type": "text/html" } });

const router = new Router();
router.routes = [
  [new Route("get", /^\/wipe\/.*/), wipe],
  [new Route("get", /^\/raw\/.*/), raw],
  [new Route("post", /^\/value\/.*/), updateValue],
  [new Route("post", /^\/column\/.*/), createColumn],
  [new Route("get", /^\/table\/.*/), getTable],
  [new Route("get", "/tables"), listTables],
  [new Route("post", "/tables"), createTable],
  [new Route("get", /^\/$/), renderHTML],
];

export default {
  async fetch(request, env) {
    try {
      return await router.handle(request, env);
    } catch (e) {
      return jsonResponse({ message: e.message, stack: e.stack });
    }
  },
};
