import { dev } from "$app/environment";
import { base } from "$app/paths";
import { config } from "$lib/server/config";
import { collections } from "$lib/server/database";
import { redirect } from "@sveltejs/kit";

export const actions = {
	async default({ cookies, locals }) {
		await collections.sessions.deleteOne({ sessionId: locals.sessionId });

		cookies.delete(config.COOKIE_NAME, {
			path: "/",
			// So that it works inside the space's iframe
			sameSite: dev || config.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none",
			secure: !dev && !(config.ALLOW_INSECURE_COOKIES === "true"),
			httpOnly: true,
		});
		redirect(303, `${base}/`);
	},
};
