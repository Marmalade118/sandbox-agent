import type { Sandbox } from "@cloudflare/sandbox";
import { SandboxAgent } from "sandbox-agent";

export type PromptTestRequest = {
	agent?: string;
	prompt?: string;
};

export type PromptTestResponse = {
	sessionId: string;
	agent: string;
	prompt: string;
	events: unknown[];
};

export async function runPromptTest(
	sandbox: Sandbox,
	request: PromptTestRequest,
	port: number,
): Promise<PromptTestResponse> {
	const client = await SandboxAgent.connect({
		fetch: (req, init) =>
			sandbox.containerFetch(req, init, port),
	});

	let sessionId: string | null = null;
	try {
		const session = await client.createSession({
			agent: request.agent ?? "codex",
		});
		sessionId = session.id;

		const promptText =
			request.prompt?.trim() || "Reply with a short confirmation.";
		await session.prompt([{ type: "text", text: promptText }]);

		const events: unknown[] = [];
		let cursor: string | undefined;
		while (true) {
			const page = await client.getEvents({
				sessionId: session.id,
				cursor,
				limit: 200,
			});
			events.push(...page.items);
			if (!page.nextCursor) break;
			cursor = page.nextCursor;
		}

		return {
			sessionId: session.id,
			agent: session.agent,
			prompt: promptText,
			events,
		};
	} finally {
		if (sessionId) {
			try {
				await client.destroySession(sessionId);
			} catch {
				// Ignore cleanup failures; session teardown is best-effort.
			}
		}
		await client.dispose();
	}
}
