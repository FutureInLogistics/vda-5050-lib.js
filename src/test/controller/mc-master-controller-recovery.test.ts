/*! Copyright (c) 2021 Siemens AG. Licensed under the MIT License. */

// tslint:disable: no-empty

/**
 * Master controller recovery tests for `getAllOrders` and `discardOrderCache`.
 *
 * These cover the ability of the master controller to free itself from order
 * state caches that can no longer be completed or canceled through the regular
 * VDA 5050 message flow (e.g. after an AGV has lost its active order due to a
 * restart clearing its state), without relying on the AGV to help.
 */

import * as tap from "tap";

import {
    AgvController,
    AgvControllerOptions,
    createUuid,
    ErrorType,
    MasterController,
    VirtualAgvAdapter,
    VirtualAgvAdapterOptions,
} from "../..";

import { initTestContext, testClientOptions } from "../test-context";
import { createAgvId } from "../test-objects";

initTestContext(tap);

(async () => {
    await tap.test("Master Controller order cache recovery", async t => {
        const agvId = createAgvId("RobotCompany", "R01");

        const mcController = new MasterController(testClientOptions(t), {});
        const agvControllerOptions: AgvControllerOptions = { agvAdapterType: VirtualAgvAdapter };
        const agvAdapterOptions: VirtualAgvAdapterOptions = { initialBatteryCharge: 80, timeLapse: 100 };
        const agvController = new AgvController(agvId, testClientOptions(t), agvControllerOptions, agvAdapterOptions);

        t.teardown(() => agvController.stop());
        t.teardown(() => mcController.stop());

        await t.test("start AGV Controller", () => agvController.start());
        await t.test("start Master Controller", () => mcController.start());

        await t.test("getAllOrders is empty initially", async ts => {
            ts.same(mcController.getAllOrders(), [], "no orders tracked before assignment");
            ts.same(mcController.getAllOrders(agvId), [], "no orders tracked for AGV before assignment");
        });

        await t.test("discardOrderCache on unknown AGV/order returns empty", async ts => {
            ts.same(mcController.discardOrderCache(agvId), [], "nothing to reset for AGV without orders");
            ts.same(mcController.discardOrderCache(agvId, "does-not-exist"), [], "nothing to reset for unknown orderId");
        });

        await t.test("getAllOrders lists an active order and discardOrderCache force-resets it",
            ts => new Promise(async resolve => {
                const orderId = createUuid();
                let processedInvocations = 0;

                await mcController.assignOrder(agvId, {
                    orderId,
                    orderUpdateId: 0,
                    // A released base node followed by a horizon node keeps the order
                    // active after the base node has been traversed, so it never
                    // completes on its own.
                    nodes: [
                        { nodeId: "n1", sequenceId: 0, released: true, actions: [] },
                        { nodeId: "n2", sequenceId: 2, released: false, nodePosition: { x: 10, y: 0, mapId: "local" }, actions: [] },
                    ],
                    edges: [
                        { edgeId: "e12", sequenceId: 1, startNodeId: "n1", endNodeId: "n2", released: false, actions: [] },
                    ],
                }, {
                    onOrderProcessed: (withError, byCancelation, active, context) => {
                        processedInvocations++;
                        if (processedInvocations === 1) {
                            // Order processed but still active (horizon remains).
                            ts.equal(withError, undefined, "normal processing: no error");
                            ts.equal(active, true, "normal processing: order still active");

                            // Introspection: the active order must be tracked.
                            const all = mcController.getAllOrders(agvId);
                            ts.equal(all.length, 1, "one order tracked for AGV");
                            ts.equal(all[0].orderId, orderId, "tracked order has expected orderId");
                            ts.equal(all[0].orderUpdateId, 0, "tracked order has expected orderUpdateId");
                            ts.equal(all[0].isLatestAssigned, true, "tracked order is latest assigned");
                            ts.equal(all[0].lastReportedActive, true, "tracked order last reported active");
                            ts.same(mcController.getAllOrders().map(o => o.orderId), [orderId],
                                "getAllOrders() without filter also lists the order");

                            // Force-reset the order cache without any AGV interaction.
                            const reset = mcController.discardOrderCache(agvId, orderId);
                            ts.equal(reset.length, 1, "discardOrderCache reset exactly one order cache");
                            ts.equal(reset[0].orderId, orderId, "reset info carries orderId");

                            // Cache must be gone afterwards.
                            ts.same(mcController.getAllOrders(agvId), [], "no orders tracked after discardOrderCache");
                        } else if (processedInvocations === 2) {
                            // Reset invocation triggered synchronously by discardOrderCache.
                            ts.not(withError, undefined, "reset: onOrderProcessed invoked with synthetic error");
                            ts.equal(withError.errorType, ErrorType.Order, "reset error has order error type");
                            ts.equal(byCancelation, false, "reset: not by AGV cancelation");
                            ts.equal(active, false, "reset: order reported inactive");
                            ts.equal(context.order.orderId, orderId, "reset context carries the order");
                            ts.ok(context.state, "reset context provides a state object");
                            resolve();
                        } else {
                            ts.fail("onOrderProcessed invoked more than twice");
                            resolve();
                        }
                    },
                });
            }));
    });
})();
