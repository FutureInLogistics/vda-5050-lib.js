/*! Copyright (c) 2021 Siemens AG. Licensed under the MIT License. */

import * as tap from "tap";

import {
    ActionStatus,
    BlockingType,
    Headerless,
    MasterController,
    Order,
    State,
} from "../..";
import { initTestContext, testClientOptions } from "../test-context";
import { createAgvId } from "../test-objects";

initTestContext(tap);

tap.test("failed last action completes the order without cancellation", t => {
    const agvId = createAgvId("RobotCompany", "001");
    const order: Headerless<Order> = {
        orderId: "order-1",
        orderUpdateId: 0,
        nodes: [{
            nodeId: "node-1",
            sequenceId: 0,
            released: true,
            actions: [{
                actionId: "action-1",
                actionType: "pick",
                blockingType: BlockingType.Hard,
            }],
        }],
        edges: [],
    };
    const controller = new MasterController(testClientOptions(t), {});
    let isOrderStillActive = true;
    let isCanceled = true;

    controller["_addOrderStateCache"](agvId, order, {
        onOrderProcessed: (_error, byCancelation, active) => {
            isCanceled = byCancelation;
            isOrderStillActive = active;
        },
    });

    controller["_dispatchState"]({
        orderId: order.orderId,
        orderUpdateId: order.orderUpdateId,
        nodeStates: [],
        edgeStates: [],
        actionStates: [{
            actionId: "action-1",
            actionType: "pick",
            actionStatus: ActionStatus.Failed,
        }],
        errors: [],
        lastNodeId: "node-1",
        lastNodeSequenceId: 0,
    } as State, agvId);

    t.equal(isCanceled, false);
    t.equal(isOrderStillActive, false);
    t.equal(controller.getAllOrders(agvId).length, 0);
    t.end();
});

tap.test("split cancel confirmation resolves the pending order", t => {
    const agvId = createAgvId("RobotCompany", "003");
    const order: Headerless<Order> = {
        orderId: "order-3",
        orderUpdateId: 0,
        nodes: [{
            nodeId: "node-1",
            sequenceId: 0,
            released: true,
            actions: [],
        }],
        edges: [],
    };
    const controller = new MasterController(testClientOptions(t), {});
    let isCancellationConfirmed = false;
    controller["_addOrderStateCache"](agvId, order, {
        onOrderProcessed: (_error, byCancelation, active) => {
            isCancellationConfirmed = byCancelation && !active;
        },
    });

    const actionHandler = {
        onActionStateChanged: () => undefined,
        onActionError: () => undefined,
    };
    controller["_currentInstantActions"].set(agvId, new Map([
        ["cancel-1", {
            agvId,
            action: {
                actionId: "cancel-1",
                actionType: "cancelOrder",
                blockingType: BlockingType.Hard,
            },
            eventHandler: actionHandler,
            instantActionsRef: 1,
        }],
        ["cancel-2", {
            agvId,
            action: {
                actionId: "cancel-2",
                actionType: "cancelOrder",
                blockingType: BlockingType.Hard,
            },
            eventHandler: actionHandler,
            instantActionsRef: 2,
        }],
    ]));

    controller["_dispatchState"]({
        orderId: order.orderId,
        orderUpdateId: order.orderUpdateId,
        nodeStates: [{
            nodeId: "node-1",
            sequenceId: 0,
            released: true,
        }],
        edgeStates: [],
        actionStates: [
            {
                actionId: "cancel-1",
                actionType: "cancelOrder",
                actionStatus: ActionStatus.Failed,
            },
            {
                actionId: "cancel-2",
                actionType: "cancelOrder",
                actionStatus: ActionStatus.Finished,
            },
        ],
        errors: [],
        lastNodeId: "",
        lastNodeSequenceId: 0,
    } as State, agvId);

    t.equal(isCancellationConfirmed, false);
    t.equal(controller.getAllOrders(agvId).length, 1);

    controller["_dispatchState"]({
        orderId: order.orderId,
        orderUpdateId: order.orderUpdateId,
        nodeStates: [],
        edgeStates: [],
        actionStates: [],
        errors: [],
        lastNodeId: "",
        lastNodeSequenceId: 0,
    } as State, agvId);

    t.equal(isCancellationConfirmed, true);
    t.equal(controller.getAllOrders(agvId).length, 0);
    t.end();
});

function createPickOrder(orderId: string): Headerless<Order> {
    return {
        orderId,
        orderUpdateId: 0,
        nodes: [{
            nodeId: "node-1",
            sequenceId: 0,
            released: true,
            actions: [{
                actionId: "pick-1",
                actionType: "pick",
                blockingType: BlockingType.Hard,
            }],
        }],
        edges: [],
    };
}

function emptyHorizonState(order: Headerless<Order>, actionStates: State["actionStates"]): State {
    return {
        orderId: order.orderId,
        orderUpdateId: order.orderUpdateId,
        nodeStates: [],
        edgeStates: [],
        actionStates,
        errors: [],
        lastNodeId: "node-1",
        lastNodeSequenceId: 0,
    } as State;
}

const runningPick = { actionId: "pick-1", actionType: "pick", actionStatus: ActionStatus.Running };

tap.test("empty horizon after finished cancelOrder completes order with open action", t => {
    const agvId = createAgvId("RobotCompany", "004");
    const order = createPickOrder("order-4");
    const controller = new MasterController(testClientOptions(t), {});
    const processedEvents: Array<{ byCancelation: boolean, active: boolean }> = [];
    controller["_addOrderStateCache"](agvId, order, {
        onOrderProcessed: (_error, byCancelation, active) => processedEvents.push({ byCancelation, active }),
    });
    controller["_currentInstantActions"].set(agvId, new Map([
        ["cancel-1", {
            agvId,
            action: {
                actionId: "cancel-1",
                actionType: "cancelOrder",
                blockingType: BlockingType.Hard,
            },
            eventHandler: {
                onActionStateChanged: () => undefined,
                onActionError: () => undefined,
            },
            instantActionsRef: 1,
        }],
    ]));

    controller["_dispatchState"]({
        orderId: order.orderId,
        orderUpdateId: order.orderUpdateId,
        nodeStates: [{ nodeId: "node-1", sequenceId: 0, released: true }],
        edgeStates: [],
        actionStates: [
            runningPick,
            { actionId: "cancel-1", actionType: "cancelOrder", actionStatus: ActionStatus.Finished },
        ],
        errors: [],
        lastNodeId: "",
        lastNodeSequenceId: 0,
    } as State, agvId);

    t.same(processedEvents, []);

    controller["_dispatchState"](emptyHorizonState(order, [runningPick]), agvId);

    t.same(processedEvents, [{ byCancelation: true, active: false }]);
    t.equal(controller.getAllOrders(agvId).length, 0);
    t.end();
});

tap.test("empty horizon without cancelOrder keeps order with open action unprocessed", t => {
    const agvId = createAgvId("RobotCompany", "005");
    const order = createPickOrder("order-5");
    const controller = new MasterController(testClientOptions(t), {});
    let isOrderProcessedCalled = false;
    controller["_addOrderStateCache"](agvId, order, {
        onOrderProcessed: () => isOrderProcessedCalled = true,
    });

    controller["_dispatchState"](emptyHorizonState(order, [runningPick]), agvId);

    t.equal(isOrderProcessedCalled, false);
    t.equal(controller.getAllOrders(agvId).length, 1);
    t.end();
});
