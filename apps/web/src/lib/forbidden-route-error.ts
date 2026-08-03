export class ForbiddenRouteError extends Error {
  constructor(readonly permission: string) {
    super("FORBIDDEN");
    this.name = "ForbiddenRouteError";
  }
}
