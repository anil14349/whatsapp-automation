/**
 * Stand in for the Meta Graph API.
 *
 * Anything that sends builds its own WhatsAppClient from clinic credentials,
 * so the only seam is fetch itself. Without this a test reaches the real Graph
 * API, which is slow, needs a token, and passes or fails for reasons that have
 * nothing to do with the code under test.
 */

const realFetch = globalThis.fetch;

export interface GraphCall {
    url: string;
    body: any;
}

export interface GraphReply {
    ok: boolean;
    status?: number;
    payload?: unknown;
}

export function stubGraph(handler: (body: any) => GraphReply): GraphCall[] {
    const calls: GraphCall[] = [];

    globalThis.fetch = ((input: any, init?: any) => {
        let body: any = {};

        try {
            body = init?.body ? JSON.parse(init.body) : {};
        } catch {
            body = { raw: String(init?.body) };
        }

        calls.push({ url: String(input), body });

        const result = handler(body);

        return Promise.resolve(
            new Response(
                JSON.stringify(result.payload ?? { messages: [{ id: "wamid.test" }] }),
                { status: result.status ?? (result.ok ? 200 : 400) }
            )
        );
    }) as typeof fetch;

    return calls;
}

/** Meta's rejection when the recipient has not written in over 24 hours. */
export function outsideWindowReply(): GraphReply {
    return {
        ok: false,
        status: 400,
        payload: {
            error: {
                code: 131047,
                message: "Message failed to send because more than 24 hours have passed"
            }
        }
    };
}

export function restoreFetch(): void {
    globalThis.fetch = realFetch;
}
