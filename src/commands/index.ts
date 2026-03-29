/**
 * Command loader - exports all commands
 */

import * as setup from './setup';
import * as product from './product';
import * as buy from './buy';
import * as admin from './admin';
import * as subscription from './subscription';
import * as renew from './renew';
import * as cancel from './cancel';

export const commands = [
  setup,
  product,
  buy,
  admin,
  subscription,
  renew,
  cancel,
];

export function getCommandsData() {
  return commands.map(cmd => cmd.data.toJSON());
}
