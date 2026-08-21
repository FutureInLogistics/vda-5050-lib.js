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
    AgvId,
    Client,
    createUuid,
    ErrorLevel,
    ErrorType,
    Headerless,
    MasterController,
    Topic,
    TopicObject,
    VirtualAgvAdapter,
    VirtualAgvAdapterOptions,
} from "../..";

import { initTestContext, testClientOptions } from "../test-context";
import { createAgvId, createHeaderlessObject } from "../test-objects";

initTestContext(tap);

/**
 * A bare client used to publish hand-crafted State messages on behalf of an
 * AGV, so that tests can simulate state event sequences a real (virtual) AGV
 * controller would never produce.
 */
class RawAgvStateClient extends Client {

    publish<T extends string>(
        topic: T extends Topic ? T : string,
        subject: AgvId,
        object: Headerless<TopicObject<T>>) {
        return this.publishTopic(topic, subject, object);
    }
}

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
                            ts.equal(withError.errorType, ErrorType.OrderCacheReset, "reset error has order cache reset error type");
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

    await tap.test("Master Controller stitching chain survives skipped state events", async t => {
        // Regression test: when a stitching order's first state event merges and
        // removes its (nearest still-tracked) base order cache, the backward
        // `lastCache` chain must be re-linked past the removed cache. Otherwise,
        // an older order that is still tracked because the AGV never reported a
        // State for the intermediate stitched order becomes unreachable and its
        // cache is retained forever.
        const agvId = createAgvId("RobotCompany", "R02");

        const mcController = new MasterController(testClientOptions(t), {});
        // No AGV controller: states are hand-crafted so that the AGV appears to
        // skip state events for intermediate stitched orders.
        const agvClient = new RawAgvStateClient(testClientOptions(t));

        t.teardown(() => agvClient.stop());
        t.teardown(() => mcController.stop());

        await t.test("start Master Controller", () => mcController.start());
        await t.test("start raw AGV state client", () => agvClient.start());

        // One released base node, one horizon node, one unreleased edge: the
        // order never completes on its own and triggers no edge events.
        const createOrder = (orderId: string, tag: string) => ({
            orderId,
            orderUpdateId: 0,
            nodes: [
                { nodeId: `${tag}1`, sequenceId: 0, released: true, actions: [] },
                { nodeId: `${tag}2`, sequenceId: 2, released: false, nodePosition: { x: 10, y: 0, mapId: "local" }, actions: [] },
            ],
            edges: [
                { edgeId: `${tag}e`, sequenceId: 1, startNodeId: `${tag}1`, endNodeId: `${tag}2`, released: false, actions: [] },
            ],
        });

        const orderIdA = createUuid();
        const orderIdB = createUuid();
        const orderIdC = createUuid();

        let stateUpdates = 0;
        let awaitStateUpdate: () => void;

        await t.test("assign three stitched orders without any AGV state", async ts => {
            await mcController.assignOrder(agvId, createOrder(orderIdA, "a"), { onOrderProcessed: () => { } });
            await mcController.assignOrder(agvId, createOrder(orderIdB, "b"), { onOrderProcessed: () => { } });
            await mcController.assignOrder(agvId, createOrder(orderIdC, "c"), {
                onOrderProcessed: () => { },
                onStateUpdate: () => {
                    stateUpdates++;
                    awaitStateUpdate?.();
                },
            });
            ts.same(mcController.getAllOrders(agvId).map(o => o.orderId).sort(),
                [orderIdA, orderIdB, orderIdC].sort(), "all three orders tracked");
        });

        // A State reported for the newest order only, i.e. the AGV skips state
        // events for the intermediate stitched orders. Released node states keep
        // the order active so that no terminal event is emitted.
        const publishStateForNewestOrder = async () => {
            const numUpdates = stateUpdates;
            const stateReceived = new Promise<void>(resolve => awaitStateUpdate = resolve);
            await agvClient.publish(Topic.State, agvId, {
                ...createHeaderlessObject(Topic.State),
                orderId: orderIdC,
                orderUpdateId: 0,
                nodeStates: [
                    { nodeId: "a1", sequenceId: 0, released: true },
                    { nodeId: "b1", sequenceId: 0, released: true },
                    { nodeId: "c1", sequenceId: 0, released: true },
                ],
            });
            await stateReceived;
            return numUpdates + 1;
        };

        await t.test("first state event on newest order merges nearest tracked base order", async ts => {
            const expectedUpdates = await publishStateForNewestOrder();
            ts.equal(stateUpdates, expectedUpdates, "state dispatched on newest order");
            ts.same(mcController.getAllOrders(agvId).map(o => o.orderId).sort(),
                [orderIdA, orderIdC].sort(), "intermediate order merged and removed, oldest order still tracked");
        });

        await t.test("next state event still reaches the oldest order across the removed cache", async ts => {
            const expectedUpdates = await publishStateForNewestOrder();
            ts.equal(stateUpdates, expectedUpdates, "state dispatched on newest order");
            ts.same(mcController.getAllOrders(agvId).map(o => o.orderId),
                [orderIdC], "oldest order merged and removed via re-linked chain");
        });
    });

    await tap.test("Master Controller retains acknowledgement across cache reuse", async t => {
        const agvId = createAgvId("RobotCompany", "R03");
        const clientOptions = testClientOptions(t, { vdaVersion: "2.1.0" });
        const mcController = new MasterController(clientOptions, {});
        const agvClient = new RawAgvStateClient(clientOptions);

        t.teardown(() => agvClient.stop());
        t.teardown(() => mcController.stop());

        await mcController.start();
        await agvClient.start();

        const order = {
            orderId: createUuid(),
            orderUpdateId: 0,
            nodes: [{ nodeId: "n1", sequenceId: 0, released: true, actions: [] }],
            edges: [],
        };
        let resolveFirstOrderProcessed: () => void;
        const firstOrderProcessed = new Promise<void>(resolve => resolveFirstOrderProcessed = resolve);
        await mcController.assignOrder(agvId, order, {
            onOrderProcessed: withError => {
                t.equal(withError, undefined, "first assignment completes successfully");
                resolveFirstOrderProcessed();
            },
        });

        await agvClient.publish(Topic.State, agvId, {
            ...createHeaderlessObject(Topic.State),
            orderId: order.orderId,
            orderUpdateId: order.orderUpdateId,
            lastNodeId: "n1",
        });
        await firstOrderProcessed;

        let wasRejected = false;
        await mcController.assignOrder(agvId, order, {
            onOrderProcessed: withError => {
                if (withError?.errorType === ErrorType.OrderNoRoute) {
                    wasRejected = true;
                }
            },
        });
        await agvClient.publish(Topic.State, agvId, {
            ...createHeaderlessObject(Topic.State),
            orderId: "different-order",
            orderUpdateId: 0,
            errors: [{
                errorType: ErrorType.OrderNoRoute,
                errorLevel: ErrorLevel.Warning,
                errorReferences: [
                    { referenceKey: "orderId", referenceValue: order.orderId },
                    { referenceKey: "orderUpdateId", referenceValue: order.orderUpdateId.toString() },
                ],
            }],
        });
        await new Promise(resolve => setTimeout(resolve, 300));

        t.equal(wasRejected, false, "stale rejection does not terminate the acknowledged order");
        t.equal(mcController.getAllOrders(agvId).length, 1, "reused order cache remains tracked");
    });
})();
