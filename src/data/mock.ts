export const company = { name: "Mona Swahili", branches: ["All Branches", "Westlands", "Ngong Road"] };

export const ksh = (n: number) =>
  "KSh " + n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

export const kpis = [
  { label: "Net Sales", value: 184420, delta: 8.4, money: true },
  { label: "Orders", value: 308, delta: 4.1 },
  { label: "Avg Order Value", value: 599, delta: -1.8, money: true },
  { label: "Gross Profit", value: 112500, delta: 6.2, money: true },
  { label: "Gross Margin", value: 61, delta: 0.9, suffix: "%" },
  { label: "Food Cost", value: 33.4, delta: 3.1, suffix: "%", invert: true },
  { label: "Labour Cost", value: 19.2, delta: -0.6, suffix: "%", invert: true },
  { label: "Cash Position", value: 486420, delta: 2.4, money: true },
];

export const health = {
  score: 82,
  label: "Healthy",
  signals: [
    { name: "Sales", state: "Healthy" },
    { name: "Inventory", state: "Attention" },
    { name: "Cash", state: "Healthy" },
    { name: "Labour", state: "Attention" },
    { name: "Customers", state: "Healthy" },
    { name: "Kitchen", state: "Warning" },
  ] as { name: string; state: "Healthy" | "Attention" | "Warning" }[],
};

export const alerts = [
  { sev: "critical", title: "4 items are below PAR", detail: "Cooking oil, beef boneless, tomatoes, foil", branch: "Westlands", time: "12 min ago", action: "Generate PO" },
  { sev: "warning", title: "Cash variance of KSh 850 requires approval", detail: "Till 2 close-out, cashier Amina W.", branch: "Ngong Road", time: "38 min ago", action: "Review" },
  { sev: "warning", title: "Average kitchen time increased 18%", detail: "14.2 min vs 12.0 min baseline", branch: "Westlands", time: "1 hr ago", action: "Open KDS" },
  { sev: "info", title: "Supplier beef price increased 12%", detail: "Main Meat Supplier — effective today", branch: "All", time: "2 hr ago", action: "View supplier" },
  { sev: "critical", title: "3 purchase orders awaiting approval", detail: "Total value KSh 128,400", branch: "All", time: "3 hr ago", action: "Approve" },
] as const;

export const branchPerf = [
  { branch: "Westlands", sales: 121480, orders: 172, margin: 61, foodCost: 31, status: "Healthy" },
  { branch: "Ngong Road", sales: 92940, orders: 136, margin: 56, foodCost: 36, status: "Attention" },
];

export const revenueTrend = [
  { d: "Mon", sales: 142000, cost: 52000 },
  { d: "Tue", sales: 131500, cost: 49000 },
  { d: "Wed", sales: 168200, cost: 58000 },
  { d: "Thu", sales: 155900, cost: 55200 },
  { d: "Fri", sales: 201300, cost: 68400 },
  { d: "Sat", sales: 244800, cost: 82100 },
  { d: "Sun", sales: 184420, cost: 61600 },
];

export const salesByHour = [
  { h: "8a", v: 6200 }, { h: "10a", v: 11400 }, { h: "12p", v: 32100 },
  { h: "2p", v: 28700 }, { h: "4p", v: 14200 }, { h: "6p", v: 26400 },
  { h: "8p", v: 41200 }, { h: "10p", v: 18300 },
];

export const salesByChannel = [
  { name: "Dine-In", value: 96400 },
  { name: "Take Away", value: 43200 },
  { name: "Delivery", value: 31400 },
  { name: "Online", value: 13420 },
];

export type Product = {
  id: string; name: string; category: string; price: number; prep: number; popular?: boolean; out?: boolean;
};

export const products: Product[] = [
  { id: "p1", name: "Chicken Biryani", category: "Main Meals", price: 1200, prep: 18, popular: true },
  { id: "p2", name: "Beef Pilau", category: "Swahili", price: 900, prep: 15, popular: true },
  { id: "p3", name: "Beef Dry Fry", category: "Grill", price: 950, prep: 20 },
  { id: "p4", name: "Chicken Curry", category: "Main Meals", price: 1050, prep: 17 },
  { id: "p5", name: "Fish Curry", category: "Swahili", price: 1150, prep: 22 },
  { id: "p6", name: "Bhajia", category: "Sides", price: 350, prep: 9, popular: true },
  { id: "p7", name: "Chips", category: "Sides", price: 250, prep: 8 },
  { id: "p8", name: "Passion Juice", category: "Drinks", price: 300, prep: 3, popular: true },
  { id: "p9", name: "Fresh Lime Juice", category: "Drinks", price: 280, prep: 3 },
  { id: "p10", name: "Soda 500ml", category: "Drinks", price: 150, prep: 1 },
  { id: "p11", name: "Mahamri (4pcs)", category: "Breakfast", price: 200, prep: 6 },
  { id: "p12", name: "Viazi Karai", category: "Swahili", price: 320, prep: 10 },
  { id: "p13", name: "Grilled Tilapia", category: "Grill", price: 1400, prep: 25, out: true },
  { id: "p14", name: "Chapati (2pcs)", category: "Sides", price: 120, prep: 5 },
  { id: "p15", name: "Mango Lassi", category: "Drinks", price: 380, prep: 4 },
  { id: "p16", name: "Kaimati", category: "Desserts", price: 300, prep: 7 },
];

export const posCategories = ["Popular", "Breakfast", "Swahili", "Grill", "Main Meals", "Sides", "Drinks", "Desserts"];

export const tables = [
  { no: "01", area: "Main Dining", seats: 2, state: "Available" },
  { no: "02", area: "Main Dining", seats: 4, state: "Occupied", guests: 3, waiter: "Cecilia", amount: 3250, mins: 22 },
  { no: "03", area: "Main Dining", seats: 4, state: "Occupied", guests: 4, waiter: "Brian", amount: 5120, mins: 51 },
  { no: "04", area: "Main Dining", seats: 2, state: "Needs Cleaning" },
  { no: "05", area: "Main Dining", seats: 6, state: "Reserved", guests: 6, waiter: "Cecilia" },
  { no: "06", area: "Main Dining", seats: 4, state: "Available" },
  { no: "07", area: "Terrace", seats: 4, state: "Occupied", guests: 2, waiter: "Joan", amount: 1840, mins: 14 },
  { no: "08", area: "Terrace", seats: 2, state: "Occupied", guests: 2, waiter: "Joan", amount: 2410, mins: 33 },
  { no: "09", area: "Terrace", seats: 6, state: "Available" },
  { no: "10", area: "Terrace", seats: 4, state: "Unavailable" },
  { no: "11", area: "Private Room", seats: 8, state: "Reserved", guests: 8, waiter: "Brian" },
  { no: "12", area: "Private Room", seats: 10, state: "Occupied", guests: 4, waiter: "Cecilia", amount: 4850, mins: 47 },
];

export const tickets = [
  { id: "1842", table: "12", time: "12:42 PM", mins: 8, state: "NEW", items: ["Chicken Biryani ×2", "Beef Dry Fry ×1"], note: "NO CHILLI" },
  { id: "1843", table: "07", time: "12:44 PM", mins: 6, state: "NEW", items: ["Fish Curry ×1", "Chapati ×2"] },
  { id: "1839", table: "03", time: "12:31 PM", mins: 19, state: "PREPARING", items: ["Beef Pilau ×3", "Bhajia ×2", "Passion Juice ×3"], note: "Table in a hurry" },
  { id: "1840", table: "08", time: "12:35 PM", mins: 15, state: "PREPARING", items: ["Chicken Curry ×2", "Chips ×1"] },
  { id: "1836", table: "02", time: "12:22 PM", mins: 28, state: "READY", items: ["Viazi Karai ×2", "Mahamri ×1"] },
  { id: "1837", table: "TA-19", time: "12:26 PM", mins: 24, state: "READY", items: ["Kaimati ×3"] },
];

export const inventoryItems = [
  { name: "Beef Boneless", sku: "MEAT-001", cat: "Meat", stock: 12.6, par: 30, unit: "kg", cost: 620, price: 0, supplier: "Main Meat Supplier", status: "Low" },
  { name: "Cooking Oil", sku: "GROC-014", cat: "Groceries", stock: 9, par: 40, unit: "L", cost: 310, price: 0, supplier: "Samwest", status: "Critical" },
  { name: "Ajab Flour", sku: "GROC-002", cat: "Groceries", stock: 18, par: 20, unit: "bale", cost: 1450, price: 0, supplier: "Samwest", status: "Healthy" },
  { name: "Basmati Rice", sku: "GROC-008", cat: "Groceries", stock: 62, par: 50, unit: "kg", cost: 240, price: 0, supplier: "Samwest", status: "Healthy" },
  { name: "Tomatoes", sku: "PROD-003", cat: "Produce", stock: 6.4, par: 25, unit: "kg", cost: 120, price: 0, supplier: "Muthurwa Groceries", status: "Critical" },
  { name: "Red Onions", sku: "PROD-001", cat: "Produce", stock: 31, par: 30, unit: "kg", cost: 95, price: 0, supplier: "Muthurwa Groceries", status: "Healthy" },
  { name: "Chicken Whole", sku: "MEAT-004", cat: "Meat", stock: 24, par: 25, unit: "kg", cost: 480, price: 0, supplier: "Main Meat Supplier", status: "Low" },
  { name: "Takeaway Boxes", sku: "PACK-002", cat: "Packaging", stock: 420, par: 300, unit: "pcs", cost: 18, price: 0, supplier: "Packaging Supplier", status: "Healthy" },
  { name: "Aluminium Foil", sku: "PACK-007", cat: "Packaging", stock: 4, par: 15, unit: "roll", cost: 340, price: 0, supplier: "Packaging Supplier", status: "Critical" },
  { name: "Passion Fruit", sku: "PROD-011", cat: "Produce", stock: 14, par: 12, unit: "kg", cost: 210, price: 0, supplier: "Muthurwa Groceries", status: "Healthy" },
];

export const orders = [
  { id: "#1842", time: "12:42 PM", who: "Table 12", channel: "Dine-In", branch: "Westlands", emp: "Cecilia", amount: 4850, pay: "M-Pesa", status: "Preparing" },
  { id: "#1841", time: "12:38 PM", who: "Kelvin Otieno", channel: "Delivery", branch: "Westlands", emp: "Joan", amount: 1980, pay: "Card", status: "Paid" },
  { id: "#1840", time: "12:35 PM", who: "Table 08", channel: "Dine-In", branch: "Westlands", emp: "Joan", amount: 2410, pay: "Pending", status: "Preparing" },
  { id: "#1839", time: "12:31 PM", who: "Table 03", channel: "Dine-In", branch: "Ngong Road", emp: "Brian", amount: 5120, pay: "M-Pesa", status: "Served" },
  { id: "#1838", time: "12:28 PM", who: "Walk-in", channel: "Take Away", branch: "Ngong Road", emp: "Amina", amount: 760, pay: "Cash", status: "Completed" },
  { id: "#1837", time: "12:26 PM", who: "Sarah Njeri", channel: "Online", branch: "Westlands", emp: "System", amount: 900, pay: "M-Pesa", status: "Ready" },
  { id: "#1836", time: "12:22 PM", who: "Table 02", channel: "Dine-In", branch: "Westlands", emp: "Cecilia", amount: 3250, pay: "Pending", status: "Ready" },
  { id: "#1835", time: "12:17 PM", who: "Peter Kamau", channel: "Take Away", branch: "Ngong Road", emp: "Amina", amount: 1450, pay: "Cash", status: "Completed" },
  { id: "#1834", time: "12:11 PM", who: "Table 05", channel: "Dine-In", branch: "Ngong Road", emp: "Brian", amount: 6720, pay: "Card", status: "Cancelled" },
];

export const decisions = [
  { title: "Approve Purchase Order PO-2026-0182", value: 58400, ctx: "Main Meat Supplier · Westlands", reason: "Weekly meat replenishment, 3 items below PAR", by: "Kelvin M. (Storekeeper)", time: "22 min ago" },
  { title: "Approve cash variance", value: 850, ctx: "Till 2 · Ngong Road", reason: "Shortage at shift close-out", by: "Amina W. (Cashier)", time: "38 min ago" },
  { title: "Approve customer refund", value: 4200, ctx: "Order #1798 · Westlands", reason: "Cold food complaint, escalated by supervisor", by: "Joan A. (Supervisor)", time: "1 hr ago" },
  { title: "Approve overtime — 3 employees", value: 6300, ctx: "Kitchen · Westlands", reason: "Saturday event coverage, 12 extra hours", by: "Chef Musa", time: "2 hr ago" },
];

export const employees = [
  { name: "Cecilia Wanjiru", role: "Waiter", dept: "Service", branch: "Westlands", shift: "09:30–21:30", status: "Present" },
  { name: "Brian Otieno", role: "Waiter", dept: "Service", branch: "Ngong Road", shift: "12:00–21:30", status: "Late" },
  { name: "Amina Warsame", role: "Cashier", dept: "Front Office", branch: "Ngong Road", shift: "08:00–17:00", status: "Present" },
  { name: "Musa Kilonzo", role: "Head Chef", dept: "Kitchen", branch: "Westlands", shift: "07:00–18:00", status: "Present" },
  { name: "Joan Achieng", role: "Supervisor", dept: "Operations", branch: "Westlands", shift: "10:00–20:00", status: "Present" },
  { name: "Kelvin Mwangi", role: "Storekeeper", dept: "Inventory", branch: "Westlands", shift: "07:00–16:00", status: "On Leave" },
  { name: "Faith Nduta", role: "Dispatcher", dept: "Delivery", branch: "Ngong Road", shift: "11:00–22:00", status: "Present" },
  { name: "Peter Kimani", role: "Cook", dept: "Kitchen", branch: "Ngong Road", shift: "OFF", status: "Absent" },
];

export const pnl = [
  { label: "Revenue", value: 4862400, bold: true },
  { label: "Food & Beverage Sales", value: 4512000, indent: true },
  { label: "Delivery & Service Income", value: 350400, indent: true },
  { label: "Cost of Sales", value: -1624300, bold: true },
  { label: "Gross Profit", value: 3238100, total: true },
  { label: "Operating Expenses", value: -2184600, bold: true },
  { label: "Payroll & Benefits", value: -1186400, indent: true },
  { label: "Rent & Utilities", value: -562300, indent: true },
  { label: "Marketing", value: -148900, indent: true },
  { label: "Other Operating", value: -287000, indent: true },
  { label: "Operating Profit", value: 1053500, total: true },
  { label: "Other Income / (Expenses)", value: -96200 },
  { label: "Net Profit", value: 957300, total: true, strong: true },
];