import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { company } from "@/data/mock";

export type AppRole = string;
export type AppTheme = "light" | "dark";
export type BranchScope = string;

export type CurrentUser = {
  id: string;
  name: string;
  role: AppRole;
  branch: BranchScope;
};

export const appRoles: AppRole[] = [
  "General Manager",
  "Branch Manager",
  "Cashier",
  "Storekeeper",
  "Accountant",
  "Chef",
  "Website and Marketing",
];

const defaultRole: AppRole = "Branch Manager";
const defaultBranch: BranchScope = "Westlands";
const defaultTheme: AppTheme = "light";
const branchStorageKey = "seramet.branches.v1";
const roleStorageKey = "seramet.roles.v1";
const activeRoleStorageKey = "seramet.role.emmanuel-branch-manager.v1";
const activeBranchStorageKey = "seramet.branch.emmanuel-branch-manager.v1";
const defaultUser: CurrentUser = {
  id: "emmanuel-obiambo",
  name: "Emmanuel Obiambo",
  role: "Branch Manager",
  branch: "Westlands",
};

const assignedBranchForRole = (role: AppRole, branches: BranchScope[]) => {
  if (role === "General Manager") return "All Branches";
  return branches.find((item) => item !== "All Branches") ?? "Westlands";
};

const applyTheme = (next: AppTheme) => {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.style.colorScheme = next;
};

const store = (key: string, value: string) => {
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
};

type AppContextValue = {
  branch: BranchScope;
  branches: BranchScope[];
  role: AppRole;
  roles: AppRole[];
  theme: AppTheme;
  branchLabel: string;
  isAllBranches: boolean;
  currentUser: CurrentUser;
  canSwitchBranch: boolean;
  setBranch: (branch: BranchScope) => void;
  setRole: (role: AppRole) => void;
  addBranch: (branch: BranchScope) => void;
  removeBranch: (branch: BranchScope) => void;
  addRole: (role: AppRole) => void;
  removeRole: (role: AppRole) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  matchesBranch: (branch?: string) => boolean;
};

const AppContext = createContext<AppContextValue | null>(null);

const readStored = <T extends string>(key: string, fallback: T, allowed: readonly string[]) => {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  return stored && allowed.includes(stored) ? (stored as T) : fallback;
};

const readStoredList = (key: string, fallback: string[]) => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(stored) &&
      stored.every((item) => typeof item === "string") &&
      stored.length > 0
      ? (stored as string[])
      : fallback;
  } catch {
    return fallback;
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<BranchScope[]>(() =>
    readStoredList(branchStorageKey, [...company.branches]),
  );
  const [roles, setRoles] = useState<AppRole[]>(() => readStoredList(roleStorageKey, appRoles));
  const [branch, setBranchState] = useState<BranchScope>(() =>
    readStored(
      activeBranchStorageKey,
      defaultBranch,
      readStoredList(branchStorageKey, [...company.branches]),
    ),
  );
  const [role, setRoleState] = useState<AppRole>(() =>
    readStored(activeRoleStorageKey, defaultRole, readStoredList(roleStorageKey, appRoles)),
  );
  const [theme, setThemeState] = useState<AppTheme>(() =>
    readStored("seramet.theme", defaultTheme, ["light", "dark"]),
  );

  useEffect(() => {
    applyTheme(theme);
    store("seramet.theme", theme);
  }, [theme]);

  useEffect(() => {
    store(branchStorageKey, JSON.stringify(branches));
  }, [branches]);

  useEffect(() => {
    store(roleStorageKey, JSON.stringify(roles));
  }, [roles]);

  useEffect(() => {
    const assignedBranch = assignedBranchForRole(role, branches);
    if (role !== "General Manager" && (branch === "All Branches" || !branches.includes(branch))) {
      setBranchState(assignedBranch);
      store(activeBranchStorageKey, assignedBranch);
    }
  }, [branch, branches, role]);

  const value = useMemo<AppContextValue>(() => {
    const isAllBranches = branch === "All Branches";
    return {
      branch,
      branches,
      role,
      roles,
      theme,
      branchLabel: isAllBranches ? "All branches" : `${branch} Branch`,
      isAllBranches,
      currentUser: { ...defaultUser, role, branch },
      canSwitchBranch: role === "General Manager",
      setBranch: (next) => {
        if (role !== "General Manager" && next !== branch) return;
        setBranchState(next);
        store(activeBranchStorageKey, next);
      },
      setRole: (next) => {
        setRoleState(next);
        store(activeRoleStorageKey, next);
      },
      addBranch: (next) => {
        const clean = next.trim();
        if (!clean) return;
        setBranches((current) => (current.includes(clean) ? current : [...current, clean]));
      },
      removeBranch: (target) => {
        if (target === "All Branches") return;
        setBranches((current) => current.filter((item) => item !== target));
        if (branch === target) {
          const assignedBranch = assignedBranchForRole(
            role,
            branches.filter((item) => item !== target),
          );
          setBranchState(assignedBranch);
          store(activeBranchStorageKey, assignedBranch);
        }
      },
      addRole: (next) => {
        const clean = next.trim();
        if (!clean) return;
        setRoles((current) => (current.includes(clean) ? current : [...current, clean]));
      },
      removeRole: (target) => {
        if (target === "General Manager") return;
        setRoles((current) => current.filter((item) => item !== target));
        if (role === target) {
          setRoleState(defaultRole);
          store(activeRoleStorageKey, defaultRole);
        }
      },
      setTheme: (next) => {
        applyTheme(next);
        setThemeState(next);
        store("seramet.theme", next);
      },
      toggleTheme: () =>
        setThemeState((current) => {
          const next = current === "dark" ? "light" : "dark";
          applyTheme(next);
          store("seramet.theme", next);
          return next;
        }),
      matchesBranch: (candidate) =>
        isAllBranches || candidate === undefined || candidate === branch || candidate === "All",
    };
  }, [branch, branches, role, roles, theme]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used inside AppProvider");
  return context;
}

export function useBranchRows<T extends { branch?: string }>(rows: T[]) {
  const { matchesBranch } = useAppContext();
  return useMemo(() => rows.filter((row) => matchesBranch(row.branch)), [matchesBranch, rows]);
}

export function useBranchStores<
  T extends { store?: string; warehouse?: string; from?: string; to?: string },
>(rows: T[]) {
  const { branch, isAllBranches } = useAppContext();
  return useMemo(() => {
    if (isAllBranches) return rows;
    return rows.filter((row) => {
      const haystack = `${row.store ?? ""} ${row.warehouse ?? ""} ${row.from ?? ""} ${row.to ?? ""}`;
      return haystack.includes(branch.split(" ")[0]);
    });
  }, [branch, isAllBranches, rows]);
}

export function branchMetric(value: number, branch: BranchScope) {
  if (branch === "Westlands") return Math.round(value * 0.58);
  if (branch === "Ngong Road") return Math.round(value * 0.42);
  return value;
}
