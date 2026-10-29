import assert from 'node:assert/strict';
import {resolvePartnershipFinancialEffect,assertGenericFinancialSourceInput} from '../src/server/vehicle-partnership/financial-classification';
const original={sourceType:'vehicle_partnership_opening',sourceEvent:'opening_loss',transactionType:'vp_opening_loss',direction:'revenue'};
const effect=resolvePartnershipFinancialEffect(original);assert.ok(effect,'opening loss requires an explicit trusted financial classification');assert.equal(effect.cash,'none');assert.equal(effect.operating,'none');assert.equal(effect.debit,'VP-LOSS');assert.equal(effect.credit,'VP-OPENING-CLEAR');
const reverse=resolvePartnershipFinancialEffect({...original,sourceEvent:'reversal',transactionType:'vp_opening_loss_reversal',direction:'expense',reversedTransactionId:71});assert.equal(reverse?.cash,'none');assert.equal(reverse?.operating,'none');assert.equal(reverse?.debit,'VP-OPENING-CLEAR');assert.equal(reverse?.credit,'VP-LOSS');
assert.throws(()=>assertGenericFinancialSourceInput(original));assert.throws(()=>resolvePartnershipFinancialEffect({...original,sourceType:'vehicle_expense'}));assert.throws(()=>resolvePartnershipFinancialEffect({...original,direction:'expense'}));
console.log('PASS opening financial classification: exact trusted source/event, no cash or operating P&L, opposite full reversal and generic ingress refused.');
