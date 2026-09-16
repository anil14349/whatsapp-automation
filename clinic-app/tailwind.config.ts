import type { Config } from "tailwindcss";

const config: Config = {
    content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                // Read from CSS variables so a clinic's own colour can replace
                // them at runtime. The defaults live in globals.css.
                brand: {
                    50: "var(--brand-50)",
                    500: "var(--brand-500)",
                    600: "var(--brand-600)",
                    700: "var(--brand-700)"
                }
            }
        }
    },
    plugins: []
};

export default config;
