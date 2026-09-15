import type { Config } from "tailwindcss";

const config: Config = {
    content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                brand: {
                    50: "#eef7f4",
                    500: "#0f766e",
                    600: "#0d6a62",
                    700: "#0b564f"
                }
            }
        }
    },
    plugins: []
};

export default config;
