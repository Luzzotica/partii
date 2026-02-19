Collision and contact force events
The narrow-phase can generate collision events between two colliders. Each collision event is given optional flags:

CollisionEventFlags::SENSOR is set if at least one of the colliders involved in the collision is a sensor.
CollisionEventFlags::REMOVED is set if a collision stopped because at least one of the colliders involved in the collision was removed from the physics scene.
In addition, after forces are computed by the constraints solver, contact force events may be generated between two colliders subject to non-zero contact forces. Generally, the user isn’t interested in contact force events unless the force magnitudes exceed some threshold. In order to skip low-force events, the engine will compute the sum of the magnitude of all the contacts between the two colliders and only trigger a contact force event if that magnitude is larger than the threshold set with ColliderBuilder::contact_force_event_threshold or Collider::set_contact_force_event_threshold (defaults to 0) for any of the two colliders with the ActiveEvents::CONTACT_FORCE_EVENTS flag enabled.

warning
Collision events (resp. contact force events) are only generated between two colliders if at least one of them has the ActiveEvents::COLLISION_EVENTS flag (resp. ActiveEvents::CONTACT_FORCE_EVENTS flags) in its active events.

In order to handle these events, it is necessary to collect them using a structure implementing the EventHandler trait. Because Rapier can be parallelized, this event handler must also implement Send + Sync.

One such structure provided by Rapier is the rapier::pipeline::ChannelEventCollector. This event collector contains channels from the crossbeam crate. These channels will be populated with events during each call to PhysicsPipeline::step:

// Initialize the event collector.
let (collision_send, collision_recv) = std::sync::mpsc::channel();
let (contact_force_send, contact_force_recv) = std::sync::mpsc::channel();
let event_handler = ChannelEventCollector::new(collision_send, contact_force_send);

physics_pipeline.step(
&gravity,
&integration_parameters,
&mut island_manager,
&mut broad_phase,
&mut narrow_phase,
&mut rigid_body_set,
&mut collider_set,
&mut impulse_joint_set,
&mut multibody_joint_set,
&mut ccd_solver,
&physics_hooks,
&event_handler,
);

while let Ok(collision_event) = collision_recv.try_recv() {
// Handle the collision event.
println!("Received collision event: {:?}", collision_event);
}

while let Ok(contact_force_event) = contact_force_recv.try_recv() {
// Handle the contact force event.
println!("Received contact force event: {:?}", contact_force_event);
}

Note however that if you need to access the contact information at the exact time a contact event happens, you may provide your own EventHandler implementation to access the contact pair given to EventHandler::handle_collision_event. You may just query the NarrowPhase instead (after the timestep completed), but there are some cases when the contact information is no longer available at the end of the timestep (e.g. when running multi-step CCD and the contact start during one substep and steps at a substeps right after).

info
Collision events identify the involved colliders by their handle. It is possible to retrieve the handle of the rigid-body a collider is attached to: collider_set.get(collider_handle).unwrap().parent()

The contact graph
The contact graph can be read in order to determine whether two specific non-sensor colliders are in contact, or to determine all the non-sensor colliders in contact with one particular non-sensor collider. Contact points and contact normals will also be provided when a contact exists.

The contact geometry (contact points, contact normal, penetration depth, etc.) can be read from the contact manifolds stored in a contact pair:

Each contact pair may contain multiple contact manifolds. Each contact manifold represents a set of contacts sharing the same contact normal.
Each contact manifold contains the list of geometric contacts detected by the narrow-phase.
Each contact manifold also contains a list of contacts that were processed by the constraints solver for force calculation (aka. the solver contacts). These solver contacts are a subset of the contacts detected by the narrow-phase, expressed in a way that is more efficient for the constraints solver to process. These solver contacts can be modified or deleted by the user using contact modification.
All the geometric contact data are expressed in the local-space of the colliders. The solver contacts are expressed in world-space.

info
Because the solver contacts can be modified by the user and are expressed in world-space, they are transients by nature: they are recomputed at each frame from the geometric contacts. Because of their transient nature, the constraint solver will store the forces it computes inside of the geometric contacts TrackedContact::data::impulse field instead of the solver contacts themselves.

Keep in mind that the contact graph contains one graph edge per pair detected by the broad-phase. So the fact that a contact pair can be found in the graph doesn't mean that the corresponding colliders are actually in contact (they may just be very close to one another, without touching). It is necessary to check either:

theContactPair::has_any_active_contact if you need to know if there exist at least one solver contact between the colliders.
the length of ContactManifold:points for each manifold in ContactPair::manifolds to determine if the colliders are really geometrically touching (independently from contact-modification).
info
There will always be only up to one contact manifold between two colliders with convex primitive shapes. If one collider has a shape composed of several pieces (trimesh, polyline, heightfield, or compound shape) then there will be multiple contact manifolds, one for each piece that may result in an actual contact.

/_ Find the contact pair, if it exists, between two colliders. _/
if let Some(contact_pair) = narrow_phase.contact_pair(collider_handle1, collider_handle2) {
// The contact pair exists meaning that the broad-phase identified a potential contact.
if contact_pair.has_any_active_contact {
// The contact pair has active contacts, meaning that it
// contains contacts for which contact forces were computed.
}

    // We may also read the contact manifolds to access the contact geometry.
    for manifold in &contact_pair.manifolds {
        println!("Local-space contact normal: {}", manifold.local_n1);
        println!("Local-space contact normal: {}", manifold.local_n2);
        println!("World-space contact normal: {}", manifold.data.normal);

        // Read the geometric contacts.
        for contact_point in &manifold.points {
            // Keep in mind that all the geometric contact data are expressed in the local-space of the colliders.
            println!("Found local contact point 1: {:?}", contact_point.local_p1);
            println!("Found contact distance: {:?}", contact_point.dist); // Negative if there is a penetration.
            println!("Found contact impulse: {}", contact_point.data.impulse);
            println!(
                "Found friction impulse: {}",
                contact_point.data.tangent_impulse
            );
        }

        // Read the solver contacts.
        for solver_contact in &manifold.data.solver_contacts {
            // Keep in mind that all the solver contact data are expressed in world-space.
            println!("Found solver contact point: {:?}", solver_contact.point);
            // The solver contact distance is negative if there is a penetration.
            println!("Found solver contact distance: {:?}", solver_contact.dist);
        }
    }

}

/_ Iterate through all the contact pairs involving a specific collider. _/
for contact_pair in narrow_phase.contact_pairs_with(collider_handle1) {
let other_collider = if contact_pair.collider1 == collider_handle1 {
contact_pair.collider2
} else {
contact_pair.collider1
};

    // Process the contact pair in a way similar to what we did in
    // the previous example.

}

Finally, keep in mind that the contacts and contact manifolds field names frequently end with a digit 1 or 2. For example contact_pair.manifolds[0].local_n1 and contact_pair.manifolds[0].local_n2. Fields ending with the digit 1 relate to the collider identified by contact_pair.collider1. Fields ending with the digit 2 relate to the collider identified by contact_pair.collider2.

In other words local_n1 is the contact normal expressed in the local space of the collider collider_pair.collider1, it points towards the exterior of the shape of collider_pair.collider1. On the other hand, local_n2 is expressed in the local space of the collider collider_pair.collider2 and points towards the exterior of the shape of collider_pair.collider2.

warning
The contact pair returned by narrow_phase.contact_pair(handle1, handle2) does not necessarily have contact_pair.collider1 == handle1 && contact_pair.collider2 == handle2. It could be swapped: contact_pair.collider1 == handle2 && contact_pair.collider2 == handle1.

So keep that in mind when reading the contact information because it's contact_pair.collider1 and contact_pair.collider2 that determine to what collider the digits 1 and 2 relate in the contacts and contact manifolds fields.
