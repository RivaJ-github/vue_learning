const p1 = Promise.resolve(3)
const p2 = new Promise((res, rej) => setTimeout(rej, 100, 'foo'))
const p3 = [p1, p2]

Promise.allSettled(p3).then(res=>res.forEach(res=>console.log(res.status)))