import React from "react";
import Navbar from "./Navbar/Navbar";
import Hero from "./Hero/Hero";
import { useTheme } from "../../contexts/ThemeContext";

export default function Home() {
  const { theme } = useTheme();
  return (
    <div className="lumora-public-shell" data-theme={theme}>
      <Navbar />
      <Hero />
    </div>
  );
}
