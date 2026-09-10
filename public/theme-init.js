try {
  var theme = localStorage.getItem("seramet.theme");
  var dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch (_error) {
  // Theme preference is optional and never authoritative business data.
}
