"use client";

import { useEffect, useRef, useState } from "react";

interface Notice {
    error?: string;
    success?: string;
    /** Shown once and not recoverable, so it must not disappear on a timer. */
    credential?: unknown;
}

/**
 * A confirmation that clears itself.
 *
 * "Saved." was staying on screen for the rest of the session, so a message from
 * ten minutes ago sat above the list claiming something had just happened.
 *
 * Errors are left alone. A confirmation has done its job once it has been seen,
 * but an error has to be read and usually acted on, and clearing it for someone
 * who looked away is how a failure goes unnoticed.
 */
export function useNotice<T extends Notice>(initial: T): [T, (next: T) => void] {
    const [notice, setNotice] = useState<T>(initial);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timer.current) {
                clearTimeout(timer.current);
            }
        };
    }, []);

    function update(next: T) {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }

        setNotice(next);

        if (next.success && !next.error && !next.credential) {
            timer.current = setTimeout(() => {
                setNotice((current) =>
                    current.success === next.success ? { ...current, success: undefined } : current
                );
            }, 4000);
        }
    }

    return [notice, update];
}

/**
 * The same idea for a message this component does not own.
 *
 * useActionState keeps its result until the next submit, so a confirmation from
 * a form sits there indefinitely too. Returns whether it should still be shown.
 */
export function useAutoDismiss(message: string | undefined, ms = 4000): boolean {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!message) {
            setVisible(false);
            return;
        }

        setVisible(true);

        const timer = setTimeout(() => setVisible(false), ms);

        return () => clearTimeout(timer);
    }, [message, ms]);

    return visible;
}
