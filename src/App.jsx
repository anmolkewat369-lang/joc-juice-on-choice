import { useCallback, useState } from "react";
import CartProvider from "./cart/CartProvider";
import { useRoute, useScrollReset, ROUTES, orderHref } from "./lib/route";
import AuthProvider from "./account/AuthProvider";
import { accountViewFor, ACCOUNT_VIEW } from "./account/accountRoute";
import LoginView from "./account/LoginView";
import SignupView from "./account/SignupView";
import MyOrdersView from "./account/MyOrdersView";
import ResetPasswordView from "./account/ResetPasswordView";
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
import CartView from "./components/cart/CartView";
import CheckoutView from "./components/order/CheckoutView";
import OrderConfirmation from "./components/order/OrderConfirmation";

/**
 * The existing single-page site is untouched. Ordering lives in its own hash
 * namespace (#/cart, #/checkout, #/order/:id) so every anchor, the section
 * scroll-spy and the mobile menu behave exactly as before.
 */
function Home({ filter, onFilterChange, selectCategory }) {
  return (
    <>
      <Hero />
      <CategoryCards onSelectCategory={selectCategory} />
      <FeaturedMenu onSelectCategory={selectCategory} />
      <WhyJoc />
      <MenuSection filter={filter} onFilterChange={onFilterChange} />
      <ComboSection />
      <Gallery />
      <AboutSection />
      <Location />
      <ContactSection />
    </>
  );
}

function Ordering({ route, placed, onPlaced, onSettled }) {
  if (route.name === ROUTES.CART) return <CartView />;
  if (route.name === ROUTES.CHECKOUT) return <CheckoutView onPlaced={onPlaced} />;
  if (route.name === ROUTES.ORDER) {
    return (
      <OrderConfirmation
        /* Keyed on the id alone, NOT on the token: re-keying on the token would
           unmount and remount the screen on every poll that changed nothing, and
           would throw away the loaded order. */
        key={route.orderId}
        orderId={route.orderId}
        /* The secret from an emailed `#/order/<id>?t=<token>` link. Read from the
           fragment, which never reaches a server log. Absent for an order opened
           on the device that placed it — sessionStorage already has the token. */
        token={route.token}
        initialOutcome={placed.outcome}
        storageNotice={placed.notice}
        onSettled={onSettled}
      />
    );
  }
  return null;
}

/** The four real-path account screens, chosen from the current URL path. */
function AccountView({ view }) {
  if (view === ACCOUNT_VIEW.LOGIN) return <LoginView />;
  if (view === ACCOUNT_VIEW.SIGNUP) return <SignupView />;
  if (view === ACCOUNT_VIEW.MY_ORDERS) return <MyOrdersView />;
  if (view === ACCOUNT_VIEW.RESET_PASSWORD) return <ResetPasswordView />;
  return null;
}

function AppShell() {
  const [filter, setFilter] = useState("All");
  const { route, navigate } = useRoute();
  useScrollReset(route.name);

  /**
   * Account pages are real paths (/login, /signup, /my-orders, /reset-password)
   * rendered inside the storefront shell, so the navbar and footer stay put and
   * the cart is untouched. Everything else keeps the hash routing below.
   */
  const accountView = accountViewFor(window.location.pathname);

  /** The most recent order handed over by checkout, including any failure. */
  const [placed, setPlaced] = useState({ outcome: null, notice: null });

  /** Jump to the full menu and apply a category filter in one action. */
  const selectCategory = useCallback((value) => {
    setFilter(value);
    document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handlePlaced = useCallback(
    ({ order, outcome, storage }) => {
      if (!order?.orderId) return;
      setPlaced({ outcome: outcome ?? null, notice: storage?.notice ?? null });
      navigate(orderHref(order.orderId));
    },
    [navigate],
  );

  /** A retried payment or a switch to COD clears the earlier failure notice. */
  const handleSettled = useCallback(({ outcome, switchedToCod }) => {
    setPlaced((current) => ({
      ...current,
      outcome: outcome ?? null,
      notice: switchedToCod ? null : current.notice,
    }));
  }, []);

  const ordering = route.name !== "home";

  const skipTarget = accountView ? "#main-content" : ordering ? "#order-status" : "#menu";

  return (
    <CartProvider>
      <a className="skip-link" href={skipTarget}>
        Skip to the {accountView ? "main content" : ordering ? "order status" : "menu"}
      </a>
      <Navbar />
      <main id="main-content">
        {accountView ? (
          <AccountView view={accountView} />
        ) : ordering ? (
          <Ordering route={route} placed={placed} onPlaced={handlePlaced} onSettled={handleSettled} />
        ) : (
          <Home filter={filter} onFilterChange={setFilter} selectCategory={selectCategory} />
        )}
      </main>
      {!ordering ? <Footer /> : null}
      {!ordering && !accountView ? <StickyCta /> : null}
    </CartProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
