import { getStore } from '@netlify/blobs';
import { handle } from '../lib/handler.mjs';

export default async (req) => {
  const store = getStore({ name: 'haushalt', consistency: 'strong' });
  return handle(req, { store, env: { SETUP_CODE: process.env.SETUP_CODE } });
};

export const config = { path: '/api/*' };
