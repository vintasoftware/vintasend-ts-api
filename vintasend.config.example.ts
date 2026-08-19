/**
 * Example VintaSend service factory.
 *
 * Copy this file to `vintasend.config.ts` (gitignored), adapt it to your own
 * backend, adapters and template renderer, then point the API at the compiled
 * output with `VINTASEND_SERVICE_MODULE=./vintasend.config.js`.
 *
 * The only contract is: default-export a function returning a configured
 * VintaSend service (or a promise of one). The API calls it once at startup.
 *
 * The imports below are illustrative — install the implementation packages your
 * deployment actually uses (`vintasend-prisma`, `vintasend-medplum`,
 * `vintasend-nodemailer`, `vintasend-mailgun`, `vintasend-pug`, …).
 */

// import { MedplumClient } from '@medplum/core';
// import { VintaSendFactory } from 'vintasend';
// import { MedplumNotificationBackendFactory } from 'vintasend-medplum';
// import { MailgunNotificationAdapter } from 'vintasend-mailgun';
// import { PugEmailTemplateRenderer } from 'vintasend-pug';

export default async function createVintaSendService() {
  throw new Error(
    'No VintaSend service configured. Copy vintasend.config.example.ts to vintasend.config.ts ' +
      'and build your service there.',
  );

  // const medplum = new MedplumClient({
  //   baseUrl: process.env.MEDPLUM_BASE_URL,
  //   clientId: process.env.MEDPLUM_CLIENT_ID,
  //   clientSecret: process.env.MEDPLUM_CLIENT_SECRET,
  // });
  //
  // const backend = new MedplumNotificationBackendFactory<Config>().create(medplum);
  // const renderer = new PugEmailTemplateRenderer<Config>();
  // const adapter = new MailgunNotificationAdapter<typeof renderer, Config>(renderer, {
  //   apiKey: process.env.MAILGUN_API_KEY,
  //   domain: process.env.MAILGUN_DOMAIN,
  //   fromEmail: process.env.MAILGUN_FROM_EMAIL,
  //   fromName: process.env.MAILGUN_FROM_NAME,
  // });
  //
  // return new VintaSendFactory<Config>().create(backend, [adapter], contextGenerators);
}
