import tsPlugin from "@typescript-eslint/eslint-plugin"

export default [
    {ignores: ["dist/", "docs/", "node_modules/"]},
    ...tsPlugin.configs["flat/recommended"],
]
