import { redirect } from "next/navigation";
import { readSession } from "@/lib/portal";

export default async function Home() {
    redirect((await readSession()) ? "/appointments" : "/login");
}
