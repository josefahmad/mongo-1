sh.debugMode = true;
sh.oldhelp=sh.help
sh.configDB = db.getSiblingDB("config");


function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

sh.chunkSize = function() {
    var rc = this.configDB.settings.findOne({_id: "chunksize"});
    if (!rc) rc = 64;
    rc = rc*1024*1024;
    print("Chunk Size: ", sh._dataFormat(rc))
    return rc;
}

sh.fakeChunkSizeDividedByTwo = sh.chunkSize() / 2;

sh.chunkDataSize = function(ns, key, kmin, kmax, est) {
    var rc = undefined;
    if ( this.debugMode === true ) {
        rc = { ok : 1, size: getRandomInt(0, this.fakeChunkSizeDividedByTwo) };
    }
    else {
        rc = sh._adminCommand(
            { dataSize: ns, keyPattern: key, min: kmin, max: kmax, estimate: est }
        );
    }
    return rc;
}

sh.mergeChunks = function(ns, lowerBound, upperBound) {
    var rc = undefined;
    if ( this.debugMode === true ) {
        rc = { ok : getRandomInt(0,1), msg : "Debug Mode" }
    }
    else {
        rc = this._adminCommand( { mergeChunks: ns, bounds: [ lowerBound, upperBound ] });
    }
    print("Merge Attempt: ", tojson(lowerBound), ", ", tojson(upperBound), " = ", rc.ok);
    return rc;
}

sh._mergeChunks = function(firstChunk, lastChunk) {
    var rc = { ok : 1 };
    if (firstChunk._id !== lastChunk._id) {
        rc = this.mergeChunks(firstChunk.ns, firstChunk.min, lastChunk.max);
    }
    if (rc.ok !== 1) printjson(rc);
    return rc;
}

function sendtoscreen(obj) {
	printjson(obj.toArray())
}

sh.help = function() {
	this.oldhelp()
	print("\tsh.op_count()                            Number of operations")
	print("\tsh.ops_by_hour()                         Operations by hour")
	print("\tsh.ops_by_hour_not_aborted()             Unaborted operations by hour")
	print("\tsh.ops_by_hour_not_aborted_condensed()   Condensed view")
	print("\tsh.ops_by_ns()                           Operations by namespace")
	print("\tsh.splits_and_migrations()               Operations by namespace")
	print("\tsh.errors_by_phase()                     Errors by phase")
	print("\tsh.covered_period()                      Period covered by changelog")
	print("\tsh.first_last_migration()                First and last successful migrations")
	print("\tsh.moves_by_donor()                      Shard moves sorted by donor")
	print("\tsh.rates_and_volumes()                   Successful migration rates and volumes")
}

sh.op_count = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $group : { _id : { what : "$what", note : "$details.note" }, total : { $sum : 1  } } } 
		])
	)
}

sh.ops_by_hour = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $project : { day : { $dayOfYear : "$time" }, time : { $hour : "$time" }, what : "$what", note : "$details.note" } }, 
			{ $group : { _id : { day : "$day", time : "$time", what : "$what", note : "$note" }, count : { $sum : 1 } } }, 
			{ $sort : { "_id.day" : 1, "_id.time" : 1 } } 
		])
	)
}

sh.ops_by_hour_not_aborted = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $match : { "details.note" : { $ne : 'aborted' } } },
			{ $project : { day : { $dayOfYear : "$time" }, time : { $hour : "$time" }, what : "$what" } },
			{ $group : { _id : { day : "$day", time : "$time", what : "$what" }, count : { $sum : 1 } } },
			{ $sort : { "_id.day" : 1, "_id.time" : 1 } }
		])
	)
}

sh.ops_by_hour_not_aborted_condensed = function() {
	this.configDB.changelog.aggregate([
		{ $match : { "details.note" : { $ne : 'aborted' } } },
		{ $project : { day : { $dayOfYear : "$time" }, time : { $hour : "$time" }, what : "$what" } },
		{ $group : { _id : { day : "$day", time : "$time", what : "$what" }, count : { $sum : 1 } } },
		{ $sort : { "_id.day" : 1, "_id.time" : 1 } }
	]).forEach(function(cl){ printjsononeline(cl);});
}

sh.ops_by_ns = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $group : { _id : { what : "$what", ns : "$ns", note : "$details.note" }, total : { $sum : 1  } } },
			{ $sort : { "_id.ns" : 1, "_id.what" : 1 } } 
		])
	)
}

sh.splits_and_migrations = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{$group: {
				_id:{ "ns":"$ns","server":"$server"},
				multiSplits:{$sum:{$cond:[{$eq:["$what","multi-split"]},1,0]}},
				splits:{$sum:{$cond:[{$eq:["$what","split"]},1,0]}},
				migrationAttempts:{$sum:{$cond:[{$eq:["$what","moveChunk.from"]},1,0]}},
				migrationFailures:{$sum:{$cond:[ {$eq:["$details.note","aborted" ]} ,1,0]}},
				migrations:{$sum:{$cond:[{$eq:["$what","moveChunk.commit"]},1,0]}}
			} },
			{ $sort: { _id:1, multiSplits: -1, splits: -1 } }
		])
	)
}

sh.errors_by_phase = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $match : { "details.note" : 'aborted' } },
			{ $group : { _id : { what : "$what", errmsg : "$details.errmsg" }, count : { $sum : 1 } } },
			{ $sort : { "_id.what" : 1, count : -1 } }
		])
	)
}

sh.covered_period = function() {
	sendtoscreen( this.configDB.changelog.find({},{_id:0, time:1}).limit(1) )
	sendtoscreen( this.configDB.changelog.find({},{_id:0, time:1}).sort({$natural:-1}).limit(1) )
}

sh.first_last_migration = function() {
	sendtoscreen( this.configDB.changelog.find({what:"moveChunk.commit"},{_id:0, time:1}).limit(1) )
	sendtoscreen( this.configDB.changelog.find({what:"moveChunk.commit"},{_id:0, time:1}).sort({$natural:-1}).limit(1) )
}

sh.moves_by_donor = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $match: { "what" : "moveChunk.start" }},
			{ $group : { _id: { from: "$details.from", ns : "$ns"}, count: { $sum : 1 } } },
			{ $sort : { "count" : -1 } }
		])
	)
}

sh.rates_and_volumes = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{ $match: { what: { "$in": [ "moveChunk.commit", "moveChunk.start" ] } } },
			{ $project: { _id: 0,
				what: "$what", time: "$time",
				uniqueDetails: {
					from: "$details.from", to: "$details.to",
					mink: "$details.min", maxk: "$details.max",
					ns: "$ns" },
				sizeInfo: {
					cloned: "$details.cloned",
					bytes: "$details.clonedBytes" }, } },
			{ $group: {
				_id: "$uniqueDetails",
				start: { "$min": "$time" },
				commit: { "$max": "$time" },
				count: { "$sum": 1 },
				cloned: { "$max": "$sizeInfo.cloned"},
				bytes: { "$max": "$sizeInfo.bytes" } } },
			{ $project: { _id: "$_id",
				whenStart: "$start", whenDone: "$commit",
				bytesMoved: "$bytes", docsMoved: "$cloned",
				moveTime_ms: { "$subtract": [ "$commit", "$start" ] } } },
			{ $match: { bytesMoved: { "$ne": null }, moveTime_ms: { "$ne": 0 } } },
			{ $project: { _id: "$_id",
				whenStart: "$whenStart", whenDone: "$whenDone",
				moveTime_ms: "$moveTime_ms",
				bytesMoved: "$bytesMoved", docsMoved: "$docsMoved",
				bytesPer_ms: { "$divide": [ "$bytesMoved", "$moveTime_ms" ] },
				docsPer_ms: { "$divide": [ "$docsMoved", "$moveTime_ms" ] } } },
			// outputs stats for each chunk moved ...
			{ $project: { _id: "$_id",
				whenStart: "$whenStart", whenDone: "$whenDone",
				moveTime_ms: "$moveTime_ms",
				bytesMoved: "$bytesMoved", docsMoved: "$docsMoved",
				docsPer_sec: { "$multiply": [ "$docsPer_ms", 1000.0 ] },
				MBper_sec: { "$divide": [ "$bytesPer_ms", 1048.576 ] } } }
			// optionally limit to date range, or etc...
			// , { $match: {
			//    whenStart: { "$gte": ISODate("2017-08-09T00:00:00.000Z") },
			//    whenDone: { "$lt": ISODate("2017-08-10T00:00:00.000Z") } } }
			// optionally get averages per shard-pair, or per sending shard or receiving shard or per collection, etc.
			// , { $group: {
			//    _id: "$_id.from",  // example: from-shard stats
			//    // _id: { "$_id.from", "$_id.to" }, // example: shard pair stats,
			//    // _id: { "$_id.ns" }, // example: collection chunk stats
			//    minMoveTime_ms: { "$min": "$moveTime_ms" },
			//    avgMoveTime_ms: { "$avg": "$moveTime_ms" },
			//    maxMoveTime_ms: { "$max": "$moveTime_ms" },
			//    stdevMoveTime_ms: { "$stdDevPop": "$moveTime_ms" },
			//    minMBper_sec: { "$min": "$MBper_sec" },
			//    avgMBper_sec: { "$avg": "$MBper_sec" },
			//    maxMBper_sec: { "$max": "$MBper_sec" },
			//    stdevMBper_sec: { "$stdDevPop": "$MBper_sec" } } }
			// optionally, sort for time charting or hot shards by long-time or large volume, etc., output to collection, etc.
			//, { $sort: { whenDone: 1 } }
			//, { $out: "__chunkMoveStats__" }
		])
	)
}

sh.hot_shard = function() {
	sendtoscreen(
		this.configDB.changelog.aggregate([
			{$group: {
				_id:{ "ns":"$ns","server":"$server"},
				multiSplits:{$sum:{$cond:[{$eq:["$what","multi-split"]},1,0]}},
				splits:{$sum:{$cond:[{$eq:["$what","split"]},1,0]}},
				migrationAttempts:{$sum:{$cond:[{$eq:["$what","moveChunk.from"]},1,0]}},
				migrationFailures:{$sum:{$cond:[ {$eq:["$details.note","aborted" ]} ,1,0]}},
				migrations:{$sum:{$cond:[{$eq:["$what","moveChunk.commit"]},1,0]}}
			} },
			{ $sort: { _id:1, multiSplits: -1, splits: -1 } }
		])
	)
}


sh.rebalance = function(ns) {

    var maxSize = sh.chunkSize();
    var halfSize = maxSize / 2;
    var coll = sh.configDB.collections.findOne({_id: ns});

    print("Collection: ", tojsononeline(coll))
    print("Max Size: ", sh._dataFormat(halfSize))

    // Ensure the balancer and auto splits are off
    sh.stopBalancer();
    sh.disableAutoSplit();

    // Process chunks in each shard
    sh.configDB.shards.find({state: 1}, {_id:1}).forEach(function(shard) {
        var startingChunk = undefined;  // Drop anchor
        var prevChunk = undefined;      // Previous chunk (current chunk is part of function)
        var runningSize = 0;            // Trailing aggregate chunk size

        print();
        print("------- Shard: ", shard._id, "--------");
        print();

        sh.configDB.chunks.find({"ns": ns, "shard": shard._id}).sort({min: 1}).forEach(function(chunk) {

            var dsResult = sh.chunkDataSize(ns, coll.key, chunk.min, chunk.max, true);

            // Can't retrieve size so start over
            if ( dsResult.ok === 0 ) {
                printjson(dsResult);
                startingChunk = undefined;
                return;
            }

            var dataSize = dsResult.size;
            print("Chunk: "+chunk._id, "Size: "+sh._dataFormat(dataSize), "Running: "+sh._dataFormat(runningSize));

            // Start processing
            if ( startingChunk === undefined ) {
                startingChunk = chunk;
                prevChunk = chunk;
                runningSize = 0;
            }

            // Chunk big enough, merge any accumulated chunks
            // then start over
            if ( dataSize > halfSize ) {
                sh._mergeChunks(startingChunk, prevChunk)
                startingChunk = undefined;
                return;
            }

            // Commulative chunks must be merged
            if ( runningSize > halfSize ) {
                sh._mergeChunks(startingChunk, prevChunk)
                startingChunk = chunk;
                runningSize = 0;
            }

            prevChunk = chunk;
            runningSize += dataSize;
        });

        // Merge any leftovers
        sh._mergeChunks(startingChunk, prevChunk)
    });
}

