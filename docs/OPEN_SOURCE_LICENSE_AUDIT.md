# Open Source License Audit

No upstream source code has been copied into Seramet/NexusCore in this phase.

| Project          | Repository                                       | Role                               | Source Copied? | Current License Handling               | Compliance Requirement                                      |
| ---------------- | ------------------------------------------------ | ---------------------------------- | -------------- | -------------------------------------- | ----------------------------------------------------------- |
| Frappe Framework | `https://github.com/frappe/frappe`               | Foundation/backend candidate       | No             | Concept and architecture research only | Inspect exact license and commit before any code reuse.     |
| ERPNext          | `https://github.com/frappe/erpnext`              | ERP/accounting/inventory candidate | No             | Concept and workflow research only     | Use adapter/mapping; do not merge repository.               |
| Frappe HR / HRMS | `https://github.com/frappe/hrms`                 | HR/payroll candidate               | No             | Concept and workflow research only     | Inspect exact license and commit before any integration.    |
| NexoPOS          | `https://github.com/blair2004/NexoPOS`           | POS workflow research              | No             | Concept research only                  | Reimplement patterns in Seramet UI if useful.               |
| Odoo Community   | `https://github.com/odoo/odoo`                   | ERP workflow research              | No             | Concept research only                  | Do not copy code without full license review.               |
| Frappe CRM       | `https://github.com/frappe/crm`                  | CRM workflow research              | No             | Concept research only                  | Avoid second customer master.                               |
| Dolibarr         | `https://github.com/Dolibarr/dolibarr`           | SME ERP workflow research          | No             | Concept research only                  | Inspect license before any code reuse.                      |
| Open Source POS  | `https://github.com/opensourcepos/opensourcepos` | Register/cash-up workflow research | No             | Concept research only                  | Reimplement only, unless license review approves otherwise. |
