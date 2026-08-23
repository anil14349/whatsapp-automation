import { Hero } from "@/components/Hero";
import { Problem } from "@/components/Problem";
import { Solution } from "@/components/Solution";
import { Ownership } from "@/components/Ownership";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Pricing } from "@/components/Pricing";
import { FAQ } from "@/components/FAQ";
import { FinalCTA } from "@/components/FinalCTA";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <Solution />
      <Ownership />
      <Features />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </>
  );
}
