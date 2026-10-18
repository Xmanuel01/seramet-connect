import { permissions as p } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";
export const staffRolePresets: Record<string, { label: string; permissions: PermissionCode[] }> = {
  chef: {
    label: "Chef",
    permissions: [p.attendanceUse, p.cookbookView, p.kitchenView, p.kitchenOperate],
  },
  headChef: {
    label: "Head chef",
    permissions: [
      p.attendanceUse,
      p.cookbookView,
      p.cookbookManage,
      p.cookbookPublish,
      p.kitchenView,
      p.kitchenOperate,
      p.productionView,
      p.productionPlan,
      p.productionStart,
      p.productionComplete,
      p.procurementRequisitionCreate,
    ],
  },
  bartender: {
    label: "Bartender",
    permissions: [
      p.attendanceUse,
      p.cookbookView,
      p.kitchenView,
      p.kitchenOperate,
      p.procurementRequisitionCreate,
    ],
  },
  cashier: {
    label: "Cashier",
    permissions: [
      p.attendanceUse,
      p.posAccess,
      p.ordersView,
      p.ordersCreate,
      p.ordersUpdate,
      p.ordersServe,
      p.invoicesView,
      p.invoicesManage,
      p.invoicesCreate,
      p.paymentsView,
      p.paymentsRecord,
      p.paymentsCollect,
      p.cashOpen,
      p.cashClose,
    ],
  },
  supervisor: {
    label: "Supervisor",
    permissions: [
      p.attendanceUse,
      p.staffView,
      p.staffManage,
      p.ordersView,
      p.cookbookView,
      p.cookbookManage,
      p.cookbookPublish,
      p.kitchenView,
      p.kitchenOperate,
      p.procurementView,
      p.procurementRequisitionCreate,
    ],
  },
};
