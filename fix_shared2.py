with open("artifacts/edupulse/src/components/shared.tsx", "r") as f:
    shared = f.read()

shared = shared.replace(
    "import { useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey, useGetCurrentUserSchools } from '@workspace/api-client-react';",
    "import { useGetAuthorizedContext, useListSchools, getListSchoolsQueryKey, useGetCurrentUserSchools, getGetCurrentUserSchoolsQueryKey } from '@workspace/api-client-react';"
)

shared = shared.replace(
    "const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data } });",
    "const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !isPlatformOwner && !!contextQuery.data, queryKey: getGetCurrentUserSchoolsQueryKey() } });"
)
shared = shared.replace(
    "const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !context?.isPlatformOwner && !!contextQuery.data } });",
    "const userSchoolsQuery = useGetCurrentUserSchools({ query: { enabled: !context?.isPlatformOwner && !!contextQuery.data, queryKey: getGetCurrentUserSchoolsQueryKey() } });"
)

with open("artifacts/edupulse/src/components/shared.tsx", "w") as f:
    f.write(shared)
