export class Route {
  constructor(method, pathRegex) {
    this.method = method.toLowerCase();
    this.pathRegex = pathRegex;
  }

  matches(request) {
    if (request.method.toLowerCase() !== this.method) return false;
    const url = new URL(request.url);
    if (!url.pathname.match(this.pathRegex)) return false;

    return true;
  }
}

export class Router {
  constructor() {
    this.routes = [];
  }

  handle(request, ...args) {
    const route = this.routes.find(([route, handler]) =>
      route.matches(request)
    );
    if (route) return route[1](request, ...args);

    return new Response(null, { status: 404 });
  }
}
