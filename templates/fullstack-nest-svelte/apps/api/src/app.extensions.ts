import type { DynamicModule, Provider, Type } from "@nestjs/common";

// Owned extension slot for the Nest app. This file is yours — PodoKit never
// writes to it, so `podo update` leaves it alone. Use it to add your own modules
// or providers, or to override a PodoKit-provided provider without editing
// managed code. Because these are spread in *after* the module-wired providers,
// an override here takes precedence.
//
// Example — swap the mailer transport for your own implementation:
//   import { Mailer } from "./mailer/mailer";
//   import { MyMailer } from "./my-mailer";
//   export const extensionProviders: Provider[] = [
//     { provide: Mailer, useClass: MyMailer },
//   ];

/** Extra modules to import into AppModule (or DynamicModule overrides). */
export const extensionImports: (Type | DynamicModule)[] = [];

/** Extra or overriding providers for AppModule. Same-token providers listed here
 *  win over the ones PodoKit modules registered. */
export const extensionProviders: Provider[] = [];
