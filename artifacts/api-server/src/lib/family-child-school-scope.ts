/**
 * A parent has one profile. Its school is the default, not a second profile
 * for every child. Cross-school children additionally require an active
 * Parent membership in their own school, plus the caller's live relationship.
 */
export function familyChildSchoolScope(parent = "p", student = "st") {
  for (const alias of [parent, student]) {
    if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  }
  return `(${parent}.school_id=${student}.school_id OR EXISTS (
    SELECT 1 FROM school_memberships family_school_membership
     WHERE family_school_membership.user_id=${parent}.user_id
       AND family_school_membership.school_id=${student}.school_id
       AND family_school_membership.role='PARENT'
       AND family_school_membership.status='ACTIVE'))`;
}