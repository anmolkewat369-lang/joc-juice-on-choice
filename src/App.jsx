import { useCallback, useState } from "react";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import CategoryCards from "./components/CategoryCards";
import FeaturedMenu from "./components/FeaturedMenu";
import MenuSection from "./components/MenuSection";
import ComboSection from "./components/ComboSection";
import WhyJoc from "./components/WhyJoc";
import AboutSection from "./components/AboutSection";
import Gallery from "./components/Gallery";
import Location from "./components/Location";
import ContactSection from "./components/ContactSection";
import Footer from "./components/Footer";
import StickyCta from "./components/StickyCta";

export default function App() {
  const [filter, setFilter] = useState("All");

  /** Jump to the full menu and apply a category filter in one action. */
  const selectCategory = useCallback((value) => {
    setFilter(value);
    document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <a className="skip-link" href="#menu">
        Skip to the menu
      </a>
      <Navbar />
      <main>
        <Hero />
        <CategoryCards onSelectCategory={selectCategory} />
        <FeaturedMenu onSelectCategory={selectCategory} />
        <WhyJoc />
        <MenuSection filter={filter} onFilterChange={setFilter} />
        <ComboSection />
        <Gallery />
        <AboutSection />
        <Location />
        <ContactSection />
      </main>
      <Footer />
      <StickyCta />
    </>
  );
}
