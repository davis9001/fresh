import type { FreshContext } from "./context.ts";
import type { Method } from "./router.ts";

export interface Render<T> {
  data: T;
  head?: string[];
  headers?: HeadersInit;
  status?: number;
}

/**
 * A handler function that can be used to specify how a given route should
 * handle requests.
 *
 * The handler function can either return a {@link Response} object, or some
 * data that can be rendered by a page component. See {@link HandlerFn} for more
 * information.
 *
 * ### Per method handlers
 *
 * A route handler can be specific to a given HTTP method (GET, POST, PUT,
 * DELETE, etc). To define a method-specific handler, specify an object that
 * maps method names to functions that conform to the {@link HandlerFn}
 * signature.
 *
 * ```ts
 * export const handlers = defineHandlers({
 *   GET: (ctx) => {
 *     return new Response("Hello from a GET request!");
 *   },
 *   POST: (ctx) => {
 *     return new Response("Hello from a POST request!");
 *   }
 * });
 * ```
 *
 * Any requests to methods not specified in the handler object will result in a
 * 405 Method Not Allowed response. If you want to handle these requests, you
 * can define a catch-all handler.
 *
 * If a GET handler is specified, but no HEAD handler is specified, a HEAD
 * handler will automatically be generated that calls the GET handler and
 * strips the response body.
 *
 * ### Catch-all handlers
 *
 * A route handler can also catch all requests in a route. To define a catch-all
 * handler, specify a function that conforms to the {@link HandlerFn} signature.
 * This function will be called for all requests, regardless of the method.
 *
 * ```ts
 * export const handlers = defineHandlers((ctx) => {
 *   return new Response(`Hello from a ${ctx.req.method} request!`);
 * });
 * ```
 */
export type RouteHandler<Data, State> =
  | HandlerFn<Data, State>
  | HandlerByMethod<Data, State>;

export function isHandlerByMethod<D, S>(
  handler: RouteHandler<D, S>,
): handler is HandlerByMethod<D, S> {
  return handler !== null && typeof handler === "object";
}

/**
 * A handler function that is invoked when a request is made to a route. The
 * handler function is passed a {@link FreshContext} object that contains the
 * original request object, as well as any state related to the current request.
 *
 * The handler function can either return a {@link Response} object, which will
 * be sent back to the client, or some data that will be passed to the routes'
 * page component for rendering.
 *
 * ### Returning a Response
 *
 * If the handler function returns a {@link Response} object, the response will
 * be sent back to the client. This can be used to send back static content, or
 * to redirect the client to another URL.
 *
 * ```ts
 * export const handler = defineHandler((ctx) => {
 *   return new Response("Hello, world!");
 * });
 * ```
 *
 * ### Returning data
 *
 * If the handler function returns an object with a `data` property, the data
 * will be passed to the page component, where it can be rendered into HTML.
 *
 * ```ts
 * export const handler = defineHandler((ctx) => {
 *   return { data: { message: "Hello, world!" } };
 * });
 *
 * export default definePage<typeof handler>(({ data }) => {
 *   return <h1>{data.message}</h1>;
 * });
 * ```
 *
 * When returning data, you can also specify additional properties that will be
 * used when constructing the response object from the HTML generated by the
 * page component. For example, you can specify custom headers, a custom status
 * code, or a list of elements to include in the `<head>`.
 *
 * ```tsx
 * export const handler = defineHandler((ctx) => {
 *   return {
 *     data: { message: "Hello, world!" },
 *     headers: { "Cache-Control": "public, max-age=3600" },
 *     status: 201,
 *     head: [<title>Hello, world!</title>],
 *   };
 * });
 * ```
 *
 * ### Asynchronous handlers
 *
 * The handler function can also be asynchronous. This can be useful if you need
 * to fetch data from an external source, or perform some other asynchronous
 * operation before returning a response.
 *
 * ```ts
 * export const handler = defineHandler(async (ctx) => {
 *   const resp = await fetch("https://api.example.com/data").;
 *   if (!resp.ok) {
 *     throw new Error("Failed to fetch data");
 *   }
 *   const data = await resp.json();
 *   return { data };
 * });
 * ```
 *
 * If you initiate multiple asynchronous operations in a handler, you can use
 * `Promise.all` to wait for all of them to complete at the same time. This can
 * speed up the response time of your handler, as it allows you to perform
 * multiple operations concurrently.
 *
 * ```ts
 * export const handler = defineHandler(async (ctx) => {
 *   const [resp1, resp2] = await Promise.all([
 *     fetch("https://api.example.com/data1")
 *       .then((resp) => resp.json()),
 *     fetch("https://api.example.com/data2")
 *       .then((resp) => resp.json()),
 *   ]);
 *   return { data: { data1, data2 } };
 * });
 * ```
 */
export interface HandlerFn<Data, State> {
  (ctx: FreshContext<Data, State>):
    | Response
    | Render<Data>
    | Promise<Response | Render<Data>>;
}

/**
 * A set of handler functions that routes requests based on the HTTP method.
 *
 * See {@link RouteHandler} for more information on how to use this type.
 */
export type HandlerByMethod<Data, State> = {
  [M in Method]?: HandlerFn<Data, State>;
};

export type RouteData<
  Handler extends RouteHandler<unknown, unknown>,
> = Handler extends (RouteHandler<infer Data, unknown>) ? Data
  : never;
