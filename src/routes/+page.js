import { redirect } from '@sveltejs/kit';

export const prerender = false;

/** @param {import('./$types').PageLoad} event */
export function load({ url }) {
  throw redirect(302, `/map${url.search}`);
}
