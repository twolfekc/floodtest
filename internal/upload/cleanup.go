package upload

import (
	"context"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Cleanup removes orphaned objects left behind by previous runs.
// It lists all objects under the "wan-test/" prefix and deletes them.
func Cleanup(ctx context.Context, client *s3.Client, bucket string) error {
	var deleted int

	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String("wan-test/"),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, obj := range page.Contents {
			_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(bucket),
				Key:    obj.Key,
			})
			if err != nil {
				log.Printf("cleanup: failed to delete %s: %v", aws.ToString(obj.Key), err)
				continue
			}
			deleted++
		}
	}

	if deleted > 0 {
		log.Printf("cleanup: removed %d orphaned object(s) from %s", deleted, bucket)
	}
	return nil
}
