/**
 * Recording stand-in for WhatsAppClient.
 *
 * Extends the real client so the genuine Meta validation (button counts, title
 * lengths, list limits) still runs — only the network call is replaced. A test
 * that builds an over-long button title therefore fails exactly as production
 * would.
 */

import { WhatsAppApiError, WhatsAppClient } from "../../shared/whatsapp-client.ts";

export interface SentMessage {
    to: string;
    type: "text" | "buttons" | "list" | "template" | "document";
    body: string;
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
    }>;
    buttonTitle?: string;
    templateLanguage?: string;
    parameters?: string[];
    link?: string;
    filename?: string;
}

export class FakeWhatsAppClient extends WhatsAppClient {
    readonly sent: SentMessage[] = [];

    /** Set to make the next free-form send fail the way Meta would. */
    textError: WhatsAppApiError | null = null;

    /** Set to make a template send fail, e.g. one that is not registered. */
    templateError: WhatsAppApiError | null = null;

    constructor(phoneNumberId = "TEST_PHONE_ID") {
        super("TEST_ACCESS_TOKEN", phoneNumberId);
    }

    override async sendTextMessage(to: string, body: string): Promise<string> {
        if (this.textError) {
            throw this.textError;
        }

        this.sent.push({ to, type: "text", body });
        return `fake_text_${this.sent.length}`;
    }

    override async sendInteractiveButtonMessage(
        to: string,
        body: string,
        buttons: Array<{ id: string; title: string }>
    ): Promise<string> {
        if (buttons.length > 3) {
            throw new Error("Interactive button messages support max 3 buttons");
        }

        const longTitle = buttons.find((btn) => [...btn.title].length > 20);

        if (longTitle) {
            throw new Error(
                `Interactive button titles support max 20 characters: "${longTitle.title}"`
            );
        }

        this.sent.push({ to, type: "buttons", body, buttons });
        return `fake_buttons_${this.sent.length}`;
    }

    override async sendInteractiveListMessage(
        to: string,
        body: string,
        buttonTitle: string,
        sections: Array<{
            title: string;
            rows: Array<{ id: string; title: string; description?: string }>;
        }>
    ): Promise<string> {
        const totalRows = sections.reduce((count, s) => count + s.rows.length, 0);

        if (totalRows === 0) {
            throw new Error("Interactive list messages require at least one row");
        }

        if (sections.length > 10) {
            throw new Error("Interactive list messages support max 10 sections");
        }

        if (totalRows > 10) {
            throw new Error("Interactive list messages support max 10 rows across all sections");
        }

        if (buttonTitle.length > 20) {
            throw new Error("Interactive list button title supports max 20 characters");
        }

        const longRow = sections
            .flatMap((s) => s.rows)
            .find((row) => [...row.title].length > 24);

        if (longRow) {
            throw new Error(
                `Interactive list row titles support max 24 characters: "${longRow.title}"`
            );
        }

        this.sent.push({ to, type: "list", body, buttonTitle, sections });
        return `fake_list_${this.sent.length}`;
    }

    override async sendDocumentMessage(
        to: string,
        link: string,
        filename: string,
        caption?: string
    ): Promise<string> {
        this.sent.push({ to, type: "document", body: caption ?? filename, link, filename });
        return `fake_document_${this.sent.length}`;
    }

    override async sendTemplateMessage(
        to: string,
        templateName: string,
        templateLanguage = "en",
        parameters?: string[]
    ): Promise<string> {
        if (this.templateError) {
            throw this.templateError;
        }

        this.sent.push({
            to,
            type: "template",
            body: templateName,
            templateLanguage,
            parameters: parameters ?? []
        });

        return `fake_template_${this.sent.length}`;
    }

    /** Every row id offered across all list messages. */
    offeredRowIds(): string[] {
        return this.sent
            .filter((m) => m.type === "list")
            .flatMap((m) => m.sections ?? [])
            .flatMap((s) => s.rows)
            .map((r) => r.id);
    }

    /** Every button id offered across all button messages. */
    offeredButtonIds(): string[] {
        return this.sent
            .filter((m) => m.type === "buttons")
            .flatMap((m) => m.buttons ?? [])
            .map((b) => b.id);
    }

    lastMessage(): SentMessage | undefined {
        return this.sent[this.sent.length - 1];
    }

    clear(): void {
        this.sent.length = 0;
    }
}
