# v75 scroll reflow hypothesis

The maximized-window desktop trace still reports Forced reflow. The main scroll listener currently mixes a DOM class write with later layout reads (`clientHeight`/`scrollHeight`) on every native scroll event. v75 will batch the listener to one `requestAnimationFrame`, snapshot geometry first, and only then perform DOM writes.
