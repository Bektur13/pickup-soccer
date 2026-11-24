/**
 * The SDK's own schema linter (deepspace/worker lintSchemas) must find nothing:
 * it catches mistakes that otherwise show up as silent permission/sync bugs,
 * e.g. a 'team' read level with no team_members collection, or an ownerField
 * that isn't userBound.
 */

import { expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from './schemas'

it('all collection schemas pass the DeepSpace schema linter', () => {
  expect(lintSchemas(schemas)).toEqual([])
})
