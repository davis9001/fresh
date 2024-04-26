import { App } from "../../app.ts";
import {
  type FreshFsItem,
  fsRoutes,
  type FsRoutesOptions,
  sortRoutePaths,
  type TESTING_ONLY__FsRoutesOptions,
} from "./mod.ts";
import { delay, FakeServer } from "../../test_utils.ts";
import * as path from "@std/path";
import { createFakeFs } from "../../test_utils.ts";
import { expect } from "@std/expect";
import type { HandlerByMethod, HandlerFn } from "../../handlers.ts";
import type { Method } from "../../router.ts";
import { parseHtml } from "../../../tests/test_utils.tsx";

async function createServer<T>(
  files: Record<string, string | Uint8Array | FreshFsItem<T>>,
): Promise<FakeServer> {
  const app = new App<T>();

  await fsRoutes(
    app,
    {
      dir: ".",
      loadIsland: async () => {},
      // deno-lint-ignore require-await
      loadRoute: async (filePath) => {
        const full = path.join("routes", filePath);
        if (full in files) {
          return files[full];
        }
        throw new Error(`Mock FS: file ${full} not found`);
      },
      _fs: createFakeFs(files),
    } as FsRoutesOptions & TESTING_ONLY__FsRoutesOptions,
  );
  return new FakeServer(await app.handler());
}

Deno.test("fsRoutes - throws error when file has no exports", async () => {
  const p = createServer({ "routes/index.tsx": {} });
  await expect(p).rejects.toMatch(/relevant exports/);
});

Deno.test("fsRoutes - registers HTTP methods on router", async () => {
  const methodHandler: HandlerByMethod<unknown, unknown> = {
    GET: () => new Response("GET"),
    POST: () => new Response("POST"),
    PATCH: () => new Response("PATCH"),
    PUT: () => new Response("PUT"),
    DELETE: () => new Response("DELETE"),
    HEAD: () => new Response("HEAD"),
  };
  const server = await createServer({
    "routes/all.ts": { handlers: methodHandler },
    "routes/get.ts": { handlers: { GET: methodHandler.GET } },
    "routes/post.ts": { handlers: { POST: methodHandler.POST } },
    "routes/patch.ts": { handlers: { PATCH: methodHandler.PATCH } },
    "routes/put.ts": { handlers: { PUT: methodHandler.PUT } },
    "routes/delete.ts": { handlers: { DELETE: methodHandler.DELETE } },
    "routes/head.ts": { handlers: { HEAD: methodHandler.HEAD } },
  });

  const methods: Method[] = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"];
  for (const method of methods) {
    const name = method.toLowerCase() as Lowercase<Method>;
    const res = await server[name]("/all");
    expect(res.status).toEqual(200);
    expect(await res.text()).toEqual(method);
  }

  // Check individual routes
  for (const method of methods) {
    const lower = method.toLowerCase() as Lowercase<Method>;
    const res = await server[lower](`/${lower}`);
    expect(res.status).toEqual(200);
    expect(await res.text()).toEqual(method);

    // Check that all other methods are forbidden
    for (const other of methods) {
      if (other === method) continue;

      const name = other.toLowerCase() as Lowercase<Method>;
      const res = await server[name](`/${lower}`);
      await res.body?.cancel();
      expect(res.status).toEqual(405);
    }
  }
});

Deno.test("fsRoutes - registers fn handler for every method", async () => {
  const handler: HandlerFn<unknown, unknown> = () => new Response("ok");
  const server = await createServer({
    "routes/all.ts": { handlers: handler },
  });

  const methods: Method[] = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"];
  for (const method of methods) {
    const name = method.toLowerCase() as Lowercase<Method>;
    const res = await server[name]("/all");
    expect(res.status).toEqual(200);
    expect(await res.text()).toEqual("ok");
  }

  // Check individual routes
  for (const method of methods) {
    const lower = method.toLowerCase() as Lowercase<Method>;
    const res = await server[lower]("/all");
    expect(res.status).toEqual(200);
    expect(await res.text()).toEqual("ok");
  }
});

Deno.test("fsRoutes - renders component without handler", async () => {
  const server = await createServer({
    "routes/all.ts": { default: () => <h1>foo</h1> },
  });

  const res = await server.get("/all");
  expect(res.status).toEqual(200);
  expect(res.headers.get("Content-Type")).toEqual("text/html; charset=utf-8");
  expect(await res.text()).toEqual(
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>foo</h1></body></html>',
  );
});

Deno.test("fsRoutes - sorts routes", async () => {
  const server = await createServer({
    "routes/[id].ts": { handler: () => new Response("fail") },
    "routes/all.ts": { handler: () => new Response("ok") },
  });

  const res = await server.get("/all");
  expect(await res.text()).toEqual("ok");
});

Deno.test("fsRoutes - serve index", async () => {
  const server = await createServer({
    "routes/[id].ts": { handler: () => new Response("fail") },
    "routes/index.ts": { handler: () => new Response("ok") },
  });

  const res = await server.get("/");
  expect(await res.text()).toEqual("ok");
});

Deno.test("fsRoutes - add middleware for function handler", async () => {
  const server = await createServer<{ text: string }>({
    "routes/[id].ts": { handler: (ctx) => new Response(ctx.state.text) },
    "routes/index.ts": { handler: (ctx) => new Response(ctx.state.text) },
    "routes/none.ts": { default: (ctx) => <>{ctx.state.text}</> },
    "routes/_middleware.ts": {
      handler(ctx) {
        ctx.state.text = "ok";
        return ctx.next();
      },
    },
  });

  let res = await server.get("/");
  expect(await res.text()).toEqual("ok");

  res = await server.get("/foo");
  expect(await res.text()).toEqual("ok");

  res = await server.get("/none");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - nested middlewares", async () => {
  const server = await createServer<{ text: string }>({
    "routes/_middleware.ts": {
      handler: (ctx) => {
        ctx.state.text = "A";
        return ctx.next();
      },
    },
    "routes/foo/_middleware.ts": {
      handler: (ctx) => {
        ctx.state.text += "B";
        return ctx.next();
      },
    },
    "routes/foo/index.ts": { default: (ctx) => <>{ctx.state.text}</> },
  });

  const res = await server.get("/foo");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("AB");
});

Deno.test("fsRoutes - middleware array", async () => {
  const server = await createServer<{ text: string }>({
    "routes/_middleware.ts": {
      handler: [
        (ctx) => {
          ctx.state.text = "A";
          return ctx.next();
        },
        (ctx) => {
          ctx.state.text += "B";
          return ctx.next();
        },
      ],
    },
    "routes/foo/_middleware.ts": {
      handler: (ctx) => {
        ctx.state.text += "C";
        return ctx.next();
      },
    },
    "routes/foo/index.ts": { default: (ctx) => <>{ctx.state.text}</> },
  });

  const res = await server.get("/foo");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ABC");
});

Deno.test("fsRoutes - combined", async () => {
  const server = await createServer<{ text: string }>({
    "routes/foo/bar.ts": {
      default: (ctx) => <>{ctx.state.text}</>,
    },
    "routes/foo/_middleware.ts": {
      handler: (ctx) => {
        ctx.state.text = "ok";
        return ctx.next();
      },
    },
    "routes/_middleware.ts": {
      handler: (ctx) => {
        ctx.state.text = "ok";
        return ctx.next();
      },
    },
  });

  const res = await server.get("/foo/bar");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - prepend _app", async () => {
  const server = await createServer({
    "routes/foo/bar.ts": {
      default: () => <>foo_bar</>,
    },
    "routes/foo.ts": {
      default: () => <>foo</>,
    },
    "routes/_app.tsx": {
      default: (ctx) => (
        <>
          app/<ctx.Component />
        </>
      ),
    },
  });

  let res = await server.get("/foo/bar");
  let doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/foo_bar");

  res = await server.get("/foo");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/foo");
});

Deno.test("fsRoutes - prepend _layout", async () => {
  const server = await createServer({
    "routes/foo/bar.ts": {
      default: () => <>foo_bar</>,
    },
    "routes/foo.ts": {
      default: () => <>foo</>,
    },
    "routes/_layout.tsx": {
      default: (ctx) => (
        <>
          layout/<ctx.Component />
        </>
      ),
    },
    "routes/_app.tsx": {
      default: (ctx) => (
        <>
          app/<ctx.Component />
        </>
      ),
    },
  });

  let res = await server.get("/foo/bar");
  let doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/layout/foo_bar");

  res = await server.get("/foo");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/layout/foo");
});

Deno.test("fsRoutes - nested _layout", async () => {
  const server = await createServer({
    "routes/foo/bar.ts": {
      default: () => <>foo_bar</>,
    },
    "routes/foo.ts": {
      default: () => <>foo</>,
    },
    "routes/foo/_layout.tsx": {
      default: (ctx) => (
        <>
          layout_foo_bar/<ctx.Component />
        </>
      ),
    },
    "routes/_layout.tsx": {
      default: (ctx) => (
        <>
          layout/<ctx.Component />
        </>
      ),
    },
    "routes/_app.tsx": {
      default: (ctx) => (
        <>
          app/<ctx.Component />
        </>
      ),
    },
  });

  let res = await server.get("/foo/bar");
  let doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/layout/layout_foo_bar/foo_bar");

  res = await server.get("/foo");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("app/layout/foo");
});

Deno.test("fsRoutes - _layout skip if not present", async () => {
  const server = await createServer({
    "routes/foo/bar/baz.ts": {
      default: () => <>foo_bar_baz</>,
    },
    "routes/foo/_layout.tsx": {
      default: (ctx) => (
        <>
          layout_foo/<ctx.Component />
        </>
      ),
    },
  });

  const res = await server.get("/foo/bar/baz");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("layout_foo/foo_bar_baz");
});

Deno.test("fsRoutes - _layout file types", async () => {
  const server = await createServer({
    "routes/js/index.js": {
      default: () => <>js</>,
    },
    "routes/js/_layout.js": {
      default: (ctx) => (
        <>
          layout_js/<ctx.Component />
        </>
      ),
    },
    "routes/jsx/index.jsx": {
      default: () => <>jsx</>,
    },
    "routes/jsx/_layout.jsx": {
      default: (ctx) => (
        <>
          layout_jsx/<ctx.Component />
        </>
      ),
    },
    "routes/ts/index.ts": {
      default: () => <>ts</>,
    },
    "routes/ts/_layout.tsx": {
      default: (ctx) => (
        <>
          layout_ts/<ctx.Component />
        </>
      ),
    },
    "routes/tsx/index.tsx": {
      default: () => <>tsx</>,
    },
    "routes/tsx/_layout.tsx": {
      default: (ctx) => (
        <>
          layout_tsx/<ctx.Component />
        </>
      ),
    },
  });

  const res = await server.get("/js");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("layout_js/js");
});

Deno.test("fsRoutes - _layout disable _app", async () => {
  const server = await createServer({
    "routes/index.tsx": {
      default: () => <>route</>,
    },
    "routes/_layout.tsx": {
      config: {
        skipAppWrapper: true,
      },
      default: (ctx) => (
        <>
          layout/<ctx.Component />
        </>
      ),
    },
    "routes/_app.tsx": {
      default: (ctx) => (
        <>
          app/<ctx.Component />
        </>
      ),
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("layout/route");
});

Deno.test(
  "fsRoutes - _layout disable _app + inherited _layouts",
  async () => {
    const server = await createServer({
      "routes/sub/sub2/index.tsx": {
        default: () => <>sub_sub2</>,
      },
      "routes/sub/sub2/_layout.tsx": {
        default: (ctx) => (
          <>
            layout_sub_sub2/<ctx.Component />
          </>
        ),
      },
      "routes/sub/_layout.tsx": {
        config: {
          skipAppWrapper: true,
          skipInheritedLayouts: true,
        },
        default: (ctx) => (
          <>
            layout_sub/<ctx.Component />
          </>
        ),
      },
      "routes/_layout.tsx": {
        default: (ctx) => (
          <>
            layout/<ctx.Component />
          </>
        ),
      },
      "routes/_app.tsx": {
        default: (ctx) => (
          <>
            app/<ctx.Component />
          </>
        ),
      },
    });

    const res = await server.get("/sub/sub2");
    const doc = parseHtml(await res.text());
    expect(doc.body.textContent).toEqual("layout_sub/layout_sub_sub2/sub_sub2");
  },
);

Deno.test("fsRoutes - route overrides _layout", async () => {
  const server = await createServer({
    "routes/index.tsx": {
      config: {
        skipInheritedLayouts: true,
      },
      default: () => <>route</>,
    },
    "routes/_layout.tsx": {
      default: (ctx) => (
        <>
          layout/<ctx.Component />
        </>
      ),
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("route");
});

Deno.test("fsRoutes - route overrides _app", async () => {
  const server = await createServer({
    "routes/index.tsx": {
      config: {
        skipAppWrapper: true,
      },
      default: () => <>route</>,
    },
    "routes/_app.tsx": {
      default: (ctx) => (
        <>
          app/<ctx.Component />
        </>
      ),
    },
    // Add some more routes on same level
    "routes/a.tsx": { default: () => <>a</> },
    "routes/b.tsx": { default: () => <>b</> },
    "routes/c.tsx": { default: () => <>c</> },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("route");
});

Deno.test("fsRoutes - _error", async () => {
  const server = await createServer({
    "routes/_error.tsx": {
      default: (ctx) => {
        return <>{(ctx.error as Error).message}</>;
      },
    },
    "routes/index.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - _error nested", async () => {
  const server = await createServer({
    "routes/_error.tsx": {
      handlers: () => {
        throw new Error("fail");
      },
    },
    "routes/foo/_error.tsx": {
      handlers: (ctx) => {
        return new Response((ctx.error as Error).message);
      },
    },
    "routes/foo/index.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
  });

  const res = await server.get("/foo");
  expect(await res.text()).toEqual("ok");
});

Deno.test("fsRoutes - _error nested throw", async () => {
  const server = await createServer({
    "routes/_error.tsx": {
      handlers: (ctx) => {
        return new Response((ctx.error as Error).message);
      },
    },
    "routes/foo/_error.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
    "routes/foo/index.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
  });

  const res = await server.get("/foo");
  expect(await res.text()).toEqual("ok");
});

Deno.test("fsRoutes - _error render component", async () => {
  const server = await createServer({
    "routes/_error.tsx": {
      default: (ctx) => {
        return <>{(ctx.error as Error).message}</>;
      },
    },
    "routes/foo/_error.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
    "routes/foo/index.tsx": {
      handlers: () => {
        throw new Error("ok");
      },
    },
  });

  const res = await server.get("/foo");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - skip _error component in non-error", async () => {
  const server = await createServer({
    "routes/_error.tsx": {
      default: function errorComp() {
        return <>fail</>;
      },
    },
    "routes/index.tsx": {
      default: () => <>ok</>,
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - route group resolve index", async () => {
  const server = await createServer<{ text: string }>({
    "routes/(foo)/_layout.tsx": {
      default: (ctx) => (
        <>
          layout/<ctx.Component />
        </>
      ),
    },
    "routes/(foo)/index.tsx": {
      default: () => <>ok</>,
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("layout/ok");
});

Deno.test("fsRoutes - route group ignores (_...) folders", async () => {
  const server = await createServer<{ text: string }>({
    "routes/(_foo)/index.tsx": {
      default: () => <>fail</>,
    },
    "routes/(foo)/index.tsx": {
      default: () => <>ok</>,
    },
  });

  const res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("ok");
});

Deno.test("fsRoutes - route group specific templates", async () => {
  const server = await createServer<{ text: string }>({
    "routes/(foo)/_error.tsx": {
      default: () => <>fail foo</>,
    },
    "routes/(foo)/_layout.tsx": {
      default: (ctx) => (
        <>
          {ctx.state.text}/(foo)_layout/<ctx.Component />
        </>
      ),
    },
    "routes/(foo)/_middleware.tsx": {
      handlers: (ctx) => {
        ctx.state.text = "(foo)_middleware";
        return ctx.next();
      },
    },
    "routes/(foo)/foo.tsx": {
      default: () => <>foo</>,
    },
    "routes/(foo)/foo_error.tsx": {
      default: () => {
        throw new Error("fail");
      },
    },
    "routes/(bar)/_error.tsx": {
      default: () => <>fail bar</>,
    },
    "routes/(bar)/_layout.tsx": {
      default: (ctx) => (
        <>
          {ctx.state.text}/(bar)_layout/<ctx.Component />
        </>
      ),
    },
    "routes/(bar)/_middleware.tsx": {
      handlers: (ctx) => {
        ctx.state.text = "(bar)_middleware";
        return ctx.next();
      },
    },
    "routes/(bar)/bar.tsx": {
      default: () => <>bar</>,
    },
    "routes/(bar)/bar_error.tsx": {
      default: () => {
        throw new Error("fail");
      },
    },
  });

  let res = await server.get("/foo");
  let doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("(foo)_middleware/(foo)_layout/foo");
  res = await server.get("/foo_error");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("fail foo");

  res = await server.get("/bar");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("(bar)_middleware/(bar)_layout/bar");

  res = await server.get("/bar_error");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("fail bar");
});

Deno.test("fsRoutes - async route components", async () => {
  const server = await createServer<{ text: string }>({
    "routes/_error.tsx": {
      default: async () => {
        await delay(1);
        return <>fail foo</>;
      },
    },
    "routes/_layout.tsx": {
      default: async (ctx) => {
        await delay(1);
        return (
          <>
            {ctx.state.text}/_layout/<ctx.Component />
          </>
        );
      },
    },
    "routes/foo.tsx": {
      default: async () => {
        await delay(1);
        return <>foo</>;
      },
    },
    "routes/foo_error.tsx": {
      default: async () => {
        await delay(1);
        throw new Error("fail");
      },
    },
  });

  let res = await server.get("/foo");
  let doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("/_layout/foo");

  res = await server.get("/foo_error");
  doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("fail foo");
});

Deno.test("fsRoutes - async route components returning response", async () => {
  const server = await createServer<{ text: string }>({
    "routes/_app.tsx": {
      default: async (ctx) => {
        await delay(1);
        if (ctx.url.searchParams.has("app")) {
          return new Response("_app");
        }
        return (
          <>
            _app/<ctx.Component />
          </>
        );
      },
    },
    "routes/_layout.tsx": {
      default: async (ctx) => {
        await delay(1);
        if (ctx.url.searchParams.has("layout")) {
          return new Response("_layout");
        }
        return (
          <>
            _layout/<ctx.Component />
          </>
        );
      },
    },
    "routes/index.tsx": {
      default: async (ctx) => {
        await delay(1);
        if (ctx.url.searchParams.has("index")) {
          return new Response("index");
        }
        return <>index</>;
      },
    },
  });

  let res = await server.get("/");
  const doc = parseHtml(await res.text());
  expect(doc.body.textContent).toEqual("_app/_layout/index");

  res = await server.get("/?app");
  let text = await res.text();
  expect(text).toEqual("_app");

  res = await server.get("/?layout");
  text = await res.text();
  expect(text).toEqual("_layout");

  res = await server.get("/?index");
  text = await res.text();
  expect(text).toEqual("index");
});

Deno.test("fsRoutes - sortRoutePaths", () => {
  let routes = [
    "/foo/[id]",
    "/foo/[...slug]",
    "/foo/bar",
    "/foo/_layout",
    "/foo/index",
    "/foo/_middleware",
    "/foo/bar/_middleware",
    "/foo/_error",
    "/foo/bar/index",
    "/foo/bar/_error",
    "/_error",
    "/foo/bar/[...foo]",
    "/foo/bar/baz",
    "/foo/bar/_layout",
  ];
  let sorted = [
    "/_error",
    "/foo/_error",
    "/foo/_middleware",
    "/foo/_layout",
    "/foo/index",
    "/foo/bar/_error",
    "/foo/bar/_middleware",
    "/foo/bar/_layout",
    "/foo/bar/index",
    "/foo/bar/baz",
    "/foo/bar/[...foo]",
    "/foo/bar",
    "/foo/[id]",
    "/foo/[...slug]",
  ];
  routes.sort(sortRoutePaths);
  expect(routes).toEqual(sorted);

  routes = [
    "/js/index.js",
    "/js/_layout.js",
    "/jsx/index.jsx",
    "/jsx/_layout.jsx",
    "/ts/index.ts",
    "/ts/_layout.tsx",
    "/tsx/index.tsx",
    "/tsx/_layout.tsx",
  ];
  routes.sort(sortRoutePaths);
  sorted = [
    "/js/_layout.js",
    "/js/index.js",
    "/jsx/_layout.jsx",
    "/jsx/index.jsx",
    "/ts/_layout.tsx",
    "/ts/index.ts",
    "/tsx/_layout.tsx",
    "/tsx/index.tsx",
  ];
  expect(routes).toEqual(sorted);
});
