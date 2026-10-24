/** School employment types supported by the employee record, not account grants. */
export const employeeCardRoles = {
  TEACHER: "Teacher",
  STAFF: "Staff",
  DRIVER: "Driver",
  ACCOUNTANT: "Accountant",
} as const;
export type EmployeeCardRole = typeof employeeCardRoles[keyof typeof employeeCardRoles];

export function employeeCardRole(value:string):EmployeeCardRole|undefined {
  const key=value.trim().toUpperCase();
  return Object.hasOwn(employeeCardRoles,key)
    ? employeeCardRoles[key as keyof typeof employeeCardRoles] : undefined;
}
